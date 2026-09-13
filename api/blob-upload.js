// api/blob-upload.js
// Modtager en PDF og lægger den i det private Blob-lager.
// Bruger OIDC-autentificering automatisk (ingen statisk token nødvendig).

import { put } from "@vercel/blob";
import { verifyToken } from "./_auth.js";

export const config = {
  api: {
    bodyParser: { sizeLimit: "4mb" },
  },
};

export default async function handler(req, res) {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: "Ikke logget ind" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { filnavn, jobId, pdfBase64 } = req.body;
    if (!filnavn || !jobId || !pdfBase64) {
      return res.status(400).json({ error: "Angiv filnavn, jobId og pdfBase64" });
    }

    const buffer = Buffer.from(pdfBase64, "base64");

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
