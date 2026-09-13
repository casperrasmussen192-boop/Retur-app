// api/session.js
// Session gemmes pr. SAG under firmaet — så flere sager kan eksistere side om side
// Nøgle: session:{firmaId}:{sagsnummer}

import { Redis } from "@upstash/redis";
import { verifyToken } from "./_auth.js";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function normSag(s) {
  return (s || "UKENDT").toString().trim().toUpperCase();
}

export default async function handler(req, res) {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: "Ikke logget ind" });

  // Sagsnummer sendes som query param (GET) eller i body (POST/DELETE)
  const sagsnummer = req.method === "GET"
    ? normSag(req.query.sag)
    : normSag(req.body?.sagsnummer || req.body?.session?.caseNum);

  const key = "session:" + user.firmaId + ":" + sagsnummer;

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

  if (req.method === "POST") {
    try {
      const { session } = req.body;
      if (!session) return res.status(400).json({ error: "Ingen session data" });
      session.senestOpdateretAf = user.navn || user.email;
      session.senestOpdateretTs = Date.now();
      await redis.set(key, JSON.stringify(session)); // Ingen udløb
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

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
