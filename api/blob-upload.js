// api/blob-upload.js
// Genererer en signeret upload-URL så browseren kan lægge en PDF direkte i Blob-lageret
// uden at filen skal igennem vores server (undgår 4.5 MB-grænsen på Vercel Functions)

import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";

function getUser(req) {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) return null;
    const token = auth.split(" ")[1];
    const user = JSON.parse(Buffer.from(token, "base64").toString("utf-8"));
    return user?.email && user?.firmaId ? user : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Ikke logget ind" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { filnavn, jobId } = req.body;
    if (!filnavn || !jobId) {
      return res.status(400).json({ error: "Angiv filnavn og jobId" });
    }

    // Filerne gemmes under firma + job, så de er isolerede og nemme at rydde op
    const pathname = `analyser/${user.firmaId}/${jobId}/${Date.now()}-${filnavn}`;

    const clientToken = await generateClientTokenFromReadWriteToken({
      pathname,
      onUploadCompleted: undefined,
      validUntil: Date.now() + 60 * 60 * 1000, // 1 time
      addRandomSuffix: true,
      allowedContentTypes: ["application/pdf"],
      maximumSizeInBytes: 20 * 1024 * 1024, // 20 MB pr. fil
      access: "private",
    });

    return res.status(200).json({ clientToken, pathname });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
