// api/process-fil.js
// Kaldes af QStash én gang pr. fil. Henter PDF'en fra Blob, analyserer den med Claude,
// og gemmer resultatet i jobbet. Browseren behøver ikke være åben.

import { Redis } from "@upstash/redis";
import { Receiver } from "@upstash/qstash";
import { get } from "@vercel/blob";
import Anthropic from "@anthropic-ai/sdk";

export const config = { api: { bodyParser: false } };

const TTL = 7 * 24 * 60 * 60;

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

  let råBody;
  try {
    råBody = await læsRåBody(req);
  } catch {
    return res.status(400).json({ error: "Kunne ikke læse body" });
  }

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

  // ── Nye, atomare nøgler i stedet for ét fælles JSON-objekt ──
  const jobKey = `job:${firmaId}:${jobId}`;
  const countKey = `job:${firmaId}:${jobId}:færdige`;
  const fejlKey = `job:${firmaId}:${jobId}:fejlede`;
  const resultaterKey = `job:${firmaId}:${jobId}:resultater`;

  // Fælles: tjek om jobbet nu er helt færdigt, og opdater status hvis så
  async function markerFærdigHvisKlar() {
    const rawMeta = await redis.get(jobKey);
    if (!rawMeta) return;
    const meta = typeof rawMeta === "string" ? JSON.parse(rawMeta) : rawMeta;
    const [færdige, fejlede] = await Promise.all([
      redis.get(countKey),
      redis.scard(fejlKey),
    ]);
    const antalFærdige = Number(færdige) || 0;
    if (antalFærdige + (fejlede || 0) >= meta.antalFiler && meta.status !== "færdig") {
      meta.status = "færdig";
      await redis.set(jobKey, JSON.stringify(meta), { ex: TTL });
    }
  }

  try {
    const blobResult = await get(blobUrl, { access: "private" });
    if (!blobResult || blobResult.statusCode !== 200 || !blobResult.stream) {
      throw new Error("Kunne ikke hente PDF fra Blob-lager");
    }
    const chunks = [];
    for await (const chunk of blobResult.stream) chunks.push(chunk);
    const pdfBuffer = Buffer.concat(chunks);
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

    // ── Atomare opdateringer: ingen læs-ret-skriv på et fælles objekt ──
    // Gem denne fils resultat som sit eget listeelement (RPUSH er atomisk)
    await redis.rpush(resultaterKey, JSON.stringify(data.ordrer || []));
    await redis.expire(resultaterKey, TTL);

    // Øg tælleren atomisk (INCR kan ikke miste opdateringer, uanset hvor mange der kører samtidig)
    await redis.incr(countKey);
    await redis.expire(countKey, TTL);

    await markerFærdigHvisKlar();

    return res.status(200).json({ success: true });
  } catch (err) {
    try {
      await redis.sadd(fejlKey, `${filnavn || "ukendt fil"} — ${err.message}`);
      await redis.expire(fejlKey, TTL);
      await markerFærdigHvisKlar();
    } catch {}
    return res.status(200).json({ success: false, error: err.message });
  }
}
