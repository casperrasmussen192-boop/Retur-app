// api/scan-vare.js
// Læser et foto af en vare/kasse/etiket og returnerer det, der KAN LÆSES på billedet:
// produktnavn, varenummer og stregkodens tal (EAN). Der gættes ikke på udseende.
// Matchning mod firmaets kendte varer sker i browseren, så kun varer appen har set før kan foreslås.

import Anthropic from "@anthropic-ai/sdk";
import { verifyToken } from "./_auth.js";

export const config = {
  api: {
    bodyParser: { sizeLimit: "4mb" },
  },
};

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function gyldigEan(s) {
  if (!/^(\d{8}|\d{13})$/.test(s)) return false;
  const c = s.split("").map(Number);
  const kontrol = c.pop();
  const sum = c.reverse().reduce((a, d, i) => a + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === kontrol;
}

export default async function handler(req, res) {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: "Ikke logget ind" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { billedeBase64 } = req.body || {};
    if (!billedeBase64 || typeof billedeBase64 !== "string") {
      return res.status(400).json({ error: "Angiv billedeBase64" });
    }

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      temperature: 0,
      system: "Du aflæser tekst og stregkoder på fotos af varer og emballage. Returner KUN rå JSON. Gæt aldrig: er noget ikke tydeligt læsbart, skal feltet være null.",
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: billedeBase64 } },
          { type: "text", text: `Aflæs det der står på varen/emballagen på billedet. Beskriv IKKE hvordan varen ser ud — kun det der er trykt som tekst eller tal.

Returner KUN JSON:
{"navn":"<produktnavn som trykt, eller null>","varenr":"<varenummer/artikelnummer som trykt (kun tal og bogstaver), eller null>","ean":"<tallene under stregkoden (8 eller 13 cifre), eller null>","storrelse":"<mål/dimension som trykt, fx 22x1mm eller 1500mm, eller null>","tekst":"<øvrig vigtig tekst på etiketten, kort, eller null>"}` },
        ],
      }],
    });

    let tekst = response.content.filter(c => c.type === "text").map(c => c.text).join("");
    tekst = tekst.replace(/```json|```/g, "").trim();
    const start = tekst.indexOf("{");
    const slut = tekst.lastIndexOf("}");
    if (start === -1 || slut === -1) return res.status(200).json({ ean: null, varenr: null, navn: null, storrelse: null, tekst: null });
    let d;
    try { d = JSON.parse(tekst.slice(start, slut + 1)); } catch { d = {}; }

    const rens = (v, maks = 200) => (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim().slice(0, maks) : null);
    const eanCifre = typeof d.ean === "string" ? d.ean.replace(/\D/g, "") : "";

    return res.status(200).json({
      // Kun en EAN med korrekt kontrolciffer returneres — en fejllæst stregkode kasseres
      ean: gyldigEan(eanCifre) ? eanCifre : null,
      varenr: rens(d.varenr, 40),
      navn: rens(d.navn),
      storrelse: rens(d.storrelse, 60),
      tekst: rens(d.tekst, 300),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
