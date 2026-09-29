// api/materialer.js
// Firmaets samlede bibliotek af kendte varenavne, på tværs af alle sager —
// bruges til autofuldførelse ved "Hurtig registrering", så selv en helt ny
// sag med nul historik kan foreslå navne set på tidligere sager.

import { Redis } from "@upstash/redis";
import { verifyToken } from "./_auth.js";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: "Ikke logget ind" });

  const key = "firma:" + user.firmaId + ":materialer";

  if (req.method === "GET") {
    try {
      const navne = await redis.smembers(key);
      return res.status(200).json({ navne: navne || [] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { navne } = req.body || {};
      if (!Array.isArray(navne) || !navne.length) {
        return res.status(400).json({ error: "Angiv navne" });
      }
      const rensede = navne.map(n => String(n || "").trim()).filter(Boolean).slice(0, 200);
      if (!rensede.length) return res.status(400).json({ error: "Ingen gyldige navne" });
      await redis.sadd(key, ...rensede);
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
