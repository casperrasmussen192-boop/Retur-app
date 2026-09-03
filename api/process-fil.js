// api/process-fil.js
// Kaldes af QStash én gang pr. fil. Henter PDF'en fra Blob, analyserer den med Claude,
// og gemmer resultatet i jobbet. Browseren behøver ikke være åben.

import { Redis } from "@upstash/redis";
import { Receiver } from "@upstash/qstash";
import { head } from "@vercel/blob";
import Anthropic from "@anthropic-ai/sdk";

export const config = { api: { bodyParser: false } };

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
});

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function læsRåBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Læs rå body — nødvendig for at kunne verificere QStash-signaturen
  let råBody;
  try {
    råBody = await læsRåBody(req);
  } catch {
    return res.status(400).json({ error: "Kunne ikke læse body" });
  }

  // Verificer at kaldet faktisk kommer fra QStash
  try {
    const signatur = req.headers["upstash-signature"];
    if (!signatur) return res.status(401).json({ error: "Mangler signatur" });
    const gyldig = await receiver.verify({ signature: signatur, body: råBody });
    if (!gyldig) return res.status(401).json({ error: "Ugyldig signatur" });
  } catch (err) {
    return res.status(401).json({ error: "Signaturverifikation fejlede" });
  }

  let payload;
  try {
    payload = JSON.parse(råBody);
  } catch {
    return res.status(400).json({ error: "Ugyldig JSON" });
  }

  const { jobId, firmaId, sagsnummer, model, blobUrl, filnavn } = payload;
  if (!jobId || !firmaId || !blobUrl) {
    return res.status(400).json({ error: "Mangler jobId, firmaId eller blobUrl" });
  }

  const jobKey = `job:${firmaId}:${jobId}`;

  try {
    // Hent PDF'en fra det private Blob-lager
    const blobInfo = await head(blobUrl);
    const pdfResp = await fetch(blobInfo.downloadUrl || blobUrl);
    const pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());
    const base64 = pdfBuffer.toString("base64");

    const modelNavn = model === "sonnet" ? "claude-sonnet-4-5" : "claude-haiku-4-5-20251001";

    const response = await client.messages.create({
      model: modelNavn,
      max_tokens: 8000,
      temperature: 0,
      system: "Du er en JSON-generator specialiseret i BD Brødrene Dahl SAP-dokumenter. Returner KUN rå JSON startende med { og sluttende med }. Inkluder alle ordrer. Afslut altid JSON korrekt.",
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
          { type: "text", text: `Sagsnummer: ${sagsnummer || "ukendt"}
Udtrækker ALLE varelinjer fra SAP-dokumentet.

VIGTIGT om dokumentnumre:
- Ordrenumre er 10-cifrede og starter med 101 (f.eks. 1010xxxxxx eller 1011xxxxxx). Læs dem fra "Ordrenr."-feltet.
- Kreditnotanumre starter med 300 og står ved "Kreditnota"-overskriften.
- IGNORER fakturanumre der starter med 111.
- IGNORER alle tal i bank-/IBAN-oplysninger nederst på siden — de er IKKE ordrenumre.

VIGTIGT om varelinjer:
- Medtag KUN varelinjer fra hoveddelen — IGNORER alt under "Leveres fra et andet lager".
- For kreditnotaer skal antal være negativt (f.eks. -3).
- Brug KUN den første linje af varebeskrivelsen som "navn" — kort og konsistent.
- Læg eventuelle ekstra beskrivelseslinjer i feltet "beskrivelse". Udelad SCIP-, EAN- og CAS-numre.

VIGTIGT om pos.nr:
- Pos.nr er et 3-cifret nummer (003, 006, 009...) i en separat "Pos" kolonne.
- Sæt "pos": null hvis kolonnen ikke er synlig — opfind ALDRIG et pos.nr.
- Fakturaer har INGEN pos-kolonne. Kun følgesedler har den.

Returner KUN JSON uden markdown:
{"ordrer":[{"ordrenr":"<101... eller 300...>","type":"<følgeseddel eller faktura eller kreditnota>","dato":"<dd-mm-yy>","linjer":[{"pos":null,"varenr":"<varenr>","navn":"<første linje>","beskrivelse":"<ekstra linjer eller tom>","antal":<tal>,"enhed":"<stk>"}]}]}` },
        ],
      }],
    });

    let tekst = response.content.filter(c => c.type === "text").map(c => c.text).join("");
    tekst = tekst.replace(/```json|```/g, "").trim();
    const start = tekst.indexOf("{");
    const slut = tekst.lastIndexOf("}");
    if (start === -1 || slut === -1) throw new Error("Intet JSON i svaret");
    const data = JSON.parse(tekst.slice(start, slut + 1));

    // Opdater jobbet med resultatet
    const raw = await redis.get(jobKey);
    if (raw) {
      const job = typeof raw === "string" ? JSON.parse(raw) : raw;
      for (const ord of data.ordrer || []) {
        const eksisterende = job.ordrer.find(o => o.ordrenr === ord.ordrenr);
        if (eksisterende) {
          for (const l of ord.linjer || []) {
            const dup = eksisterende.linjer.find(el =>
              el.varenr === l.varenr && el.pos === l.pos && el.antal === l.antal && el.navn === l.navn
            );
            if (!dup) eksisterende.linjer.push(l);
          }
        } else {
          job.ordrer.push(ord);
        }
      }
      job.færdige = (job.færdige || 0) + 1;
      if (job.færdige + (job.fejlede?.length || 0) >= job.antalFiler) job.status = "færdig";
      await redis.set(jobKey, JSON.stringify(job), { ex: 7 * 24 * 60 * 60 });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    // Registrer fejlen på jobbet, men returner 200 så QStash ikke bliver ved med at prøve
    try {
      const raw = await redis.get(jobKey);
      if (raw) {
        const job = typeof raw === "string" ? JSON.parse(raw) : raw;
        job.fejlede = job.fejlede || [];
        if (!job.fejlede.includes(filnavn)) job.fejlede.push(filnavn);
        if (job.færdige + job.fejlede.length >= job.antalFiler) job.status = "færdig";
        await redis.set(jobKey, JSON.stringify(job), { ex: 7 * 24 * 60 * 60 });
      }
    } catch {}
    return res.status(200).json({ success: false, error: err.message });
  }
}
