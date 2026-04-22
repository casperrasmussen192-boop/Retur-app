// api/analyse.js
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

function verifyToken(req) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.split(" ")[1];
    if (!token) return null;

    // Prøv JWT først
    try {
      const jwt = await import("jsonwebtoken");
      if (process.env.JWT_SECRET) {
        const decoded = jwt.default.verify(token, process.env.JWT_SECRET);
        return decoded;
      }
    } catch {}

    // Fallback: simpel base64 token fra lokal login
    try {
      const decoded = JSON.parse(atob(token));
      if (decoded.email) return { ...decoded, active: true };
    } catch {}

    return null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Token verificering
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Ikke logget ind" });
    }
    const token = authHeader.split(" ")[1];

    // Prøv base64 decode (lokal login)
    let user = null;
    try {
      user = JSON.parse(Buffer.from(token, "base64").toString("utf-8"));
    } catch {}

    // Prøv JWT (Vercel KV login)
    if (!user && process.env.JWT_SECRET) {
      try {
        const { default: jwt } = await import("jsonwebtoken");
        user = jwt.verify(token, process.env.JWT_SECRET);
      } catch {}
    }

    if (!user || !user.email) {
      return res.status(401).json({ error: "Ugyldigt login — prøv at logge ind igen" });
    }
  } catch {
    return res.status(401).json({ error: "Token fejl" });
  }

  const { pdfs, caseNum } = req.body;

  if (!pdfs || !Array.isArray(pdfs) || pdfs.length === 0) {
    return res.status(400).json({ error: "Ingen PDF-filer modtaget" });
  }

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
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      system: "Du er en JSON-generator. Returner KUN rå JSON startende med { og sluttende med }. Ingen markdown, ingen forklaring.",
      messages: [{ role: "user", content }],
    });

    const raw = response.content.map((c) => c.text || "").join("");
    const clean = raw.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          const fixed = match[0].replace(/,\s*([}\]])/g, "$1").trim();
          parsed = JSON.parse(fixed);
        }
      } else {
        throw new Error("Kunne ikke tolke svar som JSON");
      }
    }

    return res.status(200).json({ success: true, data: parsed });
  } catch (err) {
    console.error("Fejl:", err);
    return res.status(500).json({ error: "Analyse fejlede: " + err.message });
  }
}
