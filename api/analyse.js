// api/analyse.js
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Ikke logget ind" });
  }
  const token = authHeader.split(" ")[1];
  let user = null;
  try {
    user = JSON.parse(Buffer.from(token, "base64").toString("utf-8"));
  } catch {}
  if (!user || !user.email) {
    return res.status(401).json({ error: "Ugyldigt login — log ind igen" });
  }

  const { pdfs, caseNum, model: reqModel } = req.body;
  if (!pdfs || !Array.isArray(pdfs) || pdfs.length === 0) {
    return res.status(400).json({ error: "Ingen PDF-filer modtaget" });
  }

  // Vælg model — brug Sonnet til præcis analyse, Haiku til test
  const model = reqModel === "sonnet"
    ? "claude-sonnet-4-5"
    : "claude-haiku-4-5-20251001";

  const content = pdfs.map((pdf) => ({
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: pdf.data },
    title: pdf.name,
  }));

  content.push({
    type: "text",
    text: `Sagsnummer: ${caseNum || "ukendt"}
Udtrækker ALLE varelinjer fra SAP-dokumenterne.

VIGTIGT om dokumentnumre:
- Brug KUN ordrenumre der starter med 1010 eller 300. IGNORER fakturanumre der starter med 111.
- Hvis et dokument kun har et fakturanummer (111...), brug filnavnet som ordrenr i stedet.
- Hvert ordrenummer må kun optræde ÉN gang i JSON.

VIGTIGT om varelinjer:
- Medtag KUN varelinjer fra hoveddelen — IGNORER alt under "Leveres fra et andet lager".
- For kreditnotaer skal antal være negativt (f.eks. -3).
- Brug KUN den første linje af varebeskrivelsen som navn — ignorer eventuelle beskrivelseslinjer under varenr.
- Hver varelinje må kun optræde ÉN gang pr. ordrenummer.

VIGTIGT om pos.nr:
- Pos.nr er et 3-cifret nummer (003, 006, 009...) i en separat "Pos" kolonne.
- Sæt "pos": null hvis kolonnen ikke er synlig — opfind ALDRIG et pos.nr.
- Fakturaer har INGEN pos-kolonne. Kun følgesedler har den.

Returner KUN JSON uden markdown:
{"ordrer":[{"ordrenr":"<1010... eller 300...>","type":"<følgeseddel eller faktura eller kreditnota>","dato":"<dd-mm-yy>","linjer":[{"pos":null,"varenr":"<varenr>","navn":"<første linje af beskrivelse>","antal":<tal>,"enhed":"<stk>"}]}]}`,
  });

  try {
    const response = await client.messages.create({
      model: model,
      max_tokens: 8000,
      temperature: 0,
      system: "Du er en JSON-generator specialiseret i BD Brødrene Dahl SAP-dokumenter. Returner KUN rå JSON startende med { og sluttende med }. Inkluder alle ordrer. Afslut altid JSON korrekt.",
      messages: [{ role: "user", content }],
    });

    const raw = response.content.map((c) => c.text || "").join("");
    let clean = raw.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      // Forsøg at reparere ufuldstændig JSON
      clean = clean.replace(/,\s*([}\]])/g, "$1");
      const opens = (clean.match(/\{/g) || []).length;
      const closes = (clean.match(/\}/g) || []).length;
      const openArr = (clean.match(/\[/g) || []).length;
      const closeArr = (clean.match(/\]/g) || []).length;
      for (let i = 0; i < openArr - closeArr; i++) clean += "]";
      for (let i = 0; i < opens - closes; i++) clean += "}";
      try {
        parsed = JSON.parse(clean);
      } catch {
        const match = clean.match(/\{[\s\S]*\}/);
        if (match) {
          try { parsed = JSON.parse(match[0]); }
          catch { throw new Error("JSON fejl — prøv med færre PDF'er ad gangen"); }
        } else {
          throw new Error("Ingen JSON fundet i svar");
        }
      }
    }

    return res.status(200).json({ success: true, data: parsed });
  } catch (err) {
    console.error("Fejl:", err.message);
    return res.status(500).json({ error: "Analyse fejlede: " + err.message });
  }
}
