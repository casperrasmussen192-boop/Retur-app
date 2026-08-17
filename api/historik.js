// api/historik.js
// Retur-historik pr. sag — en tidslinje over alle returneringer (og analyser)
// Gemt som en Redis-liste: firma:{firmaId}:historik:{sagsnummer}

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
    return user?.email && user?.firmaId ? user : null;
  } catch { return null; }
}

function normSag(s) {
  return (s || "UKENDT").toString().trim().toUpperCase();
}

export default async function handler(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Ikke logget ind" });

  const sagsnummer = normSag(req.method === "GET" ? req.query.sag : req.body?.sagsnummer);
  const key = "firma:" + user.firmaId + ":historik:" + sagsnummer;

  // GET — hent hele tidslinjen for en sag, nyeste først
  if (req.method === "GET") {
    try {
      const raw = await redis.lrange(key, 0, -1);
      const hændelser = (raw || []).map(r => typeof r === "string" ? JSON.parse(r) : r);
      return res.status(200).json({ hændelser });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST — tilføj en ny hændelse til tidslinjen
  if (req.method === "POST") {
    try {
      const { type, titel, linjer, totalAntal, varighedSek } = req.body;
      if (!type || !titel) return res.status(400).json({ error: "Angiv type og titel" });

      const hændelse = {
        id: "h_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        type, // 'analyse' | 'retur'
        titel,
        linjer: linjer || [], // [{navn, varenr, antal, enhed}]
        totalAntal: totalAntal || 0,
        varighedSek: varighedSek || null, // Tid brugt fra sag åbnet til retur genereret
        udførtAf: user.navn || user.email,
        ts: Date.now(),
      };

      // lpush lægger nyeste hændelse forrest på listen
      await redis.lpush(key, JSON.stringify(hændelse));
      // Behold kun de seneste 200 hændelser pr. sag — undgår ubegrænset vækst
      await redis.ltrim(key, 0, 199);

      return res.status(200).json({ success: true, hændelse });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // DELETE — ryd hele historikken for en sag (bruges kun ved "Ryd alt")
  if (req.method === "DELETE") {
    try {
      await redis.del(key);
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
