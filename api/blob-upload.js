// api/blob-upload.js
// Modtager en PDF og lægger den i det private Blob-lager.
// Bruger OIDC-autentificering automatisk (ingen statisk token nødvendig).
//
// Vercel afviser requests over ca. 4,5 MB, og en PDF sendes som base64 (ca. 33 % større).
// Større filer (fx fotos af følgesedler) sendes derfor i stykker på højst ca. 2 MB hver:
//   { filnavn, jobId, pdfBase64 }                              — hel fil i ét kald (som før)
//   { filnavn, jobId, uploadId, index, total, pdfBase64 }      — ét stykke; stykkerne lægges midlertidigt
//                                                                i Redis og samles til én fil ved det sidste.

import { put } from "@vercel/blob";
import { Redis } from "@upstash/redis";
import { verifyToken } from "./_auth.js";

export const config = {
  api: {
    bodyParser: { sizeLimit: "4mb" },
  },
};

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const STYKKE_TTL = 10 * 60; // midlertidige stykker udløber efter 10 minutter
const MAX_FIL_BYTES = 20 * 1024 * 1024; // Anthropic accepterer ca. 32 MB pr. request inkl. base64
const MAX_STYKKER = 12;

export default async function handler(req, res) {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: "Ikke logget ind" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { filnavn, jobId, pdfBase64, uploadId, index, total } = req.body || {};
    if (!filnavn || !jobId || !pdfBase64) {
      return res.status(400).json({ error: "Angiv filnavn, jobId og pdfBase64" });
    }

    let buffer;
    const erStykke = uploadId !== undefined && Number(total) > 1;

    if (!erStykke) {
      buffer = Buffer.from(pdfBase64, "base64");
    } else {
      if (!/^[A-Za-z0-9-]{8,64}$/.test(String(uploadId))) return res.status(400).json({ error: "Ugyldigt uploadId" });
      const i = Number(index), n = Number(total);
      if (!Number.isInteger(i) || !Number.isInteger(n) || i < 0 || i >= n || n > MAX_STYKKER) {
        return res.status(400).json({ error: "Filen er for stor til at blive uploadet (maks. ca. 20 MB)" });
      }
      const key = (k) => `upload:${user.firmaId}:${uploadId}:${k}`;
      await redis.set(key(i), pdfBase64, { ex: STYKKE_TTL });

      // Ikke sidste stykke: bekræft modtagelse og vent på resten
      if (i < n - 1) return res.status(200).json({ success: true, modtaget: i });

      // Sidste stykke: saml alle stykker i rækkefølge
      const dele = [];
      for (let k = 0; k < n; k++) {
        const del = await redis.get(key(k));
        if (typeof del !== "string") {
          return res.status(409).json({ error: `Stykke ${k + 1} af ${n} mangler — prøv at uploade filen igen` });
        }
        dele.push(Buffer.from(del, "base64"));
      }
      buffer = Buffer.concat(dele);
      try { await Promise.all(Array.from({ length: n }, (_, k) => redis.del(key(k)))); } catch {}
    }

    if (buffer.length > MAX_FIL_BYTES) {
      return res.status(413).json({ error: "Filen er for stor (maks. ca. 20 MB)" });
    }

    // Filerne gemmes under firma + job, så de er isolerede og nemme at rydde op
    const pathname = `analyser/${user.firmaId}/${jobId}/${filnavn}`;

    const blob = await put(pathname, buffer, {
      access: "private",
      contentType: "application/pdf",
      addRandomSuffix: true,
    });

    return res.status(200).json({ success: true, blobUrl: blob.url, filnavn });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
