// api/analyse.js
// Modtager PDF-data fra frontend, kalder Anthropic med din hemmelige nøgle
// og sender struktureret JSON tilbage til brugeren.

import Anthropic from "@anthropic-ai/sdk";
import { verifyToken } from "./_auth.js";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY, // Gemt sikkert på Vercel — aldrig synlig for brugere
});

export default async function handler(req, res) {
  // Kun POST tilladt
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Verificer at brugeren er logget ind
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ error: "Ikke logget ind" });
  }

  // Tjek at brugeren har et aktivt abonnement
  if (!user.active) {
    return res
      .status(403)
      .json({ error: "Inaktivt abonnement — gå til indstillinger for at betale" });
  }

  const { pdfs, caseNum } = req.body;

  if (!pdfs || !Array.isArray(pdfs) || pdfs.length === 0) {
    return res.status(400).json({ error: "Ingen PDF-filer modtaget" });
  }

  // Byg content-array til Anthropic (samme format som før, men fra serveren)
  const content = pdfs.map((pdf) => ({
    type: "document",
    source: {
      type: "base64",
      media_type: "application/pdf",
      data: pdf.data,
    },
    title: pdf.name,
  }));

  content.push({
    type: "text",
    text: `Sagsnummer: ${caseNum || "ukendt"}
Udtrækker ALLE varelinjer fra SAP-følgesedlerne.
Returner KUN JSON uden markdown:
{"ordrer":[{"ordrenr":"<ordrenr>","dato":"<leveringsdato dd-mm-yy>","linjer":[{"varenr":"<varenr>","navn":"<beskrivelse>","antal":<tal>,"enhed":"<stk/m/etc>"}]}]}`,
  });

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 2000,
      system:
        "Ekspert i BD Brødrene Dahl SAP-følgesedler. Returnerer KUN JSON uden markdown.",
      messages: [{ role: "user", content }],
    });

    const raw = response.content.map((c) => c.text || "").join("");
    const clean = raw.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error("Kunne ikke tolke svar som JSON");
    }

    return res.status(200).json({ success: true, data: parsed });
  } catch (err) {
    console.error("Anthropic fejl:", err);
    return res.status(500).json({ error: "Analyse fejlede: " + err.message });
  }
}
