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
  // Varenummer -> varenavn (bruges til at foreslå rettelser, når et varenummer eller navn ser forkert ud)
  const varerKey = "firma:" + user.firmaId + ":varenumre";

  if (req.method === "GET") {
    try {
      const [navne, varer] = await Promise.all([redis.smembers(key), redis.hgetall(varerKey)]);
      return res.status(200).json({ navne: navne || [], varer: varer || {} });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { navne, par, overskriv } = req.body || {};

      // Par af varenummer + navn. Uden overskriv beholdes det navn, der allerede er gemt (første gælder);
      // med overskriv (brugeren har selv rettet) erstattes det.
      if (Array.isArray(par)) {
        const rene = par
          .map(p => ({ varenr: String((p && p.varenr) || "").trim().slice(0, 40), navn: String((p && p.navn) || "").trim().slice(0, 200) }))
          .filter(p => p.varenr && p.navn)
          .slice(0, 300);
        if (!rene.length) return res.status(400).json({ error: "Ingen gyldige par" });
        if (overskriv) {
          const felter = {};
          for (const p of rene) felter[p.varenr] = p.navn;
          await redis.hset(varerKey, felter);
        } else {
          const pipeline = redis.pipeline();
          for (const p of rene) pipeline.hsetnx(varerKey, p.varenr, p.navn);
          await pipeline.exec();
        }
        return res.status(200).json({ success: true });
      }

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
