// api/session.js
// Gem og hent session fra Upstash — så data er tilgængeligt på tværs af enheder

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

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
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Ikke logget ind" });

  const key = `session:${user.email}`;

  // GET — hent gemt session
  if (req.method === "GET") {
    try {
      const raw = await redis.get(key);
      if (!raw) return res.status(200).json({ session: null });
      const session = typeof raw === "string" ? JSON.parse(raw) : raw;
      return res.status(200).json({ session });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST — gem session
  if (req.method === "POST") {
    try {
      const { session } = req.body;
      if (!session) return res.status(400).json({ error: "Ingen session data" });
      // Gem i 7 dage
      await redis.set(key, JSON.stringify(session)); // Ingen udløb — gemmes indtil brugeren sletter
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // DELETE — slet session
  if (req.method === "DELETE") {
    try {
      await redis.del(key);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
