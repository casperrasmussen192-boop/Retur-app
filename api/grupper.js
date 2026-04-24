// api/grupper.js
// Modtager PDF'er, grupperer dem automatisk efter sagsnummer
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function getUser(req) {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) return null;
    const token = auth.split(" ")[1];
    const user = JSON.parse(Buffer.from(token, "base64").toString("utf-8"));
    return user?.email ? user : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Ikke logget ind" });

  const { pdfs } = req.body;
  if (!pdfs || !Array.isArray(pdfs) || pdfs.length === 0) {
    return res.status(400).json({ error: "Ingen PDF-filer modtaget" });
  }

  // Send i bundter af 5 for at undgå token-grænser
  const BATCH_SIZE = 5;
  const alleGrupper = {};

  for (let b = 0; b < Math.ceil(pdfs.length / BATCH_SIZE); b++) {
    const batch = pdfs.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);

    const content = batch.map(pdf => ({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: pdf.data },
      title: pdf.name,
    }));

    content.push({
      type: "text",
      text: `Læs disse SAP-dokumenter fra BD Brødrene Dahl.
For hvert dokument skal du finde:
- Sagsnummer (kaldes "Deres reference" eller ligner f.eks. 255560-cr, 188432-AB)
- Kundenavn
- Ordrenummer (starter med 1010 eller 300)
- Leveringsdato

Returner KUN JSON:
{"dokumenter":[{"filnavn":"<filnavn>","sagsnr":"<sagsnr>","kunde":"<kundenavn>","ordrenr":"<ordrenr>","dato":"<dd-mm-yy>"}]}`
    });

    try {
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        system: "Du er en JSON-generator. Returner KUN rå JSON. Ingen markdown.",
        messages: [{ role: "user", content }],
      });

      const raw = response.content.map(c => c.text || "").join("");
      const clean = raw.replace(/```json|```/g, "").trim();

      let parsed;
      try { parsed = JSON.parse(clean); }
      catch {
        const m = clean.match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
        else continue;
      }

      for (const dok of parsed.dokumenter || []) {
        const sag = (dok.sagsnr || "ukendt").toUpperCase().trim();
        if (!alleGrupper[sag]) {
          alleGrupper[sag] = {
            sagsnr: sag,
            kunde: dok.kunde || "",
            ordrer: [],
          };
        }
        if (dok.ordrenr && !alleGrupper[sag].ordrer.find(o => o.ordrenr === dok.ordrenr)) {
          alleGrupper[sag].ordrer.push({
            ordrenr: dok.ordrenr,
            dato: dok.dato || "",
            filnavn: dok.filnavn,
          });
        }
        // Opdater kundenavn hvis vi har et bedre
        if (dok.kunde && (!alleGrupper[sag].kunde || alleGrupper[sag].kunde === "")) {
          alleGrupper[sag].kunde = dok.kunde;
        }
      }

      // Lille pause mellem batches
      if (b < Math.ceil(pdfs.length / BATCH_SIZE) - 1) {
        await new Promise(r => setTimeout(r, 800));
      }
    } catch (err) {
      console.error("Batch fejl:", err.message);
    }
  }

  return res.status(200).json({ sager: Object.values(alleGrupper) });
}
