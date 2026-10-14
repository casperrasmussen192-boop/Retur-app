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

// EAN-8 / EAN-13: kun cifre og korrekt kontrolciffer (fanger de fleste fejllæsninger)
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

  const key = "firma:" + user.firmaId + ":materialer";
  // Varenummer -> varenavn (bruges til at foreslå rettelser, når et varenummer eller navn ser forkert ud)
  // "-v2": bibliotek nulstillet, så det kun indeholder pålidelige par (se bidragFraAnalyse i index.html)
  const varerKey = "firma:" + user.firmaId + ":varenumre-v2";
  // EAN (stregkode) -> { varenr, navn } (bruges til at genkende en vare ved scanning)
  const eanKey = "firma:" + user.firmaId + ":ean-v1";

  if (req.method === "GET") {
    try {
      const [navne, varer, ean] = await Promise.all([redis.smembers(key), redis.hgetall(varerKey), redis.hgetall(eanKey)]);
      return res.status(200).json({ navne: navne || [], varer: varer || {}, ean: ean || {} });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { navne, par, overskriv, ean } = req.body || {};

      // EAN-par: { ean, varenr, navn }. Kun gyldige EAN (8 eller 13 cifre med korrekt kontrolciffer) gemmes.
      // Samme regel som ovenfor: uden overskriv gælder det første; med overskriv har brugeren selv bekræftet.
      if (Array.isArray(ean)) {
        const rene = ean
          .map(p => ({ ean: String((p && p.ean) || "").replace(/\D/g, ""), varenr: String((p && p.varenr) || "").trim().slice(0, 40), navn: String((p && p.navn) || "").trim().slice(0, 200) }))
          .filter(p => gyldigEan(p.ean) && p.navn)
          .slice(0, 300);
        if (!rene.length) return res.status(400).json({ error: "Ingen gyldige EAN-par" });
        if (overskriv) {
          const felter = {};
          for (const p of rene) felter[p.ean] = JSON.stringify({ varenr: p.varenr, navn: p.navn });
          await redis.hset(eanKey, felter);
        } else {
          const pipeline = redis.pipeline();
          for (const p of rene) pipeline.hsetnx(eanKey, p.ean, JSON.stringify({ varenr: p.varenr, navn: p.navn }));
          await pipeline.exec();
        }
        return res.status(200).json({ success: true });
      }

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
