// api/sager.js
// Sagsoversigt — delt mellem alle brugere i samme firma
// Hver sag gemmes som et felt i en Redis hash: firma:{firmaId}:sager

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
  return (s || "").toString().trim().toUpperCase();
}

export default async function handler(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Ikke logget ind" });

  const hashKey = "firma:" + user.firmaId + ":sager";

  // GET — hent alle sager for firmaet
  if (req.method === "GET") {
    try {
      const alle = await redis.hgetall(hashKey);
      const sager = Object.values(alle || {}).map(v => typeof v === "string" ? JSON.parse(v) : v);
      // Nyeste opdateret først
      sager.sort((a, b) => (b.sidstOpdateretTs || 0) - (a.sidstOpdateretTs || 0));
      return res.status(200).json({ sager });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST — opret ny sag
  if (req.method === "POST") {
    try {
      const { sagsnummer, kunde, adresse } = req.body;
      if (!sagsnummer || !sagsnummer.trim()) {
        return res.status(400).json({ error: "Angiv sagsnummer" });
      }
      const key = normSag(sagsnummer);
      const eksisterende = await redis.hget(hashKey, key);
      if (eksisterende) {
        return res.status(400).json({ error: "Der findes allerede en sag med dette nummer" });
      }
      const sag = {
        sagsnummer: sagsnummer.trim(),
        kunde: kunde || "",
        adresse: adresse || "",
        oprettetAf: user.navn || user.email,
        oprettetTs: Date.now(),
        sidstOpdateretAf: user.navn || user.email,
        sidstOpdateretTs: Date.now(),
        ordrer: 0,
        enheder: 0,
        returneringer: 0,
      };
      await redis.hset(hashKey, { [key]: JSON.stringify(sag) });
      return res.status(200).json({ success: true, sag });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // PATCH — opdater sags-metadata (kaldes automatisk når man analyserer/genererer retur)
  if (req.method === "PATCH") {
    try {
      const { sagsnummer, ordrer, enheder, returneringer } = req.body;
      if (!sagsnummer) return res.status(400).json({ error: "Angiv sagsnummer" });
      const key = normSag(sagsnummer);
      const raw = await redis.hget(hashKey, key);
      const sag = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {
        sagsnummer, kunde: "", adresse: "", oprettetAf: user.navn || user.email, oprettetTs: Date.now(),
      };
      if (ordrer !== undefined) sag.ordrer = ordrer;
      if (enheder !== undefined) sag.enheder = enheder;
      if (returneringer !== undefined) sag.returneringer = returneringer;
      sag.sidstOpdateretAf = user.navn || user.email;
      sag.sidstOpdateretTs = Date.now();
      await redis.hset(hashKey, { [key]: JSON.stringify(sag) });
      return res.status(200).json({ success: true, sag });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // DELETE — slet en sag
  if (req.method === "DELETE") {
    try {
      const { sagsnummer } = req.body;
      if (!sagsnummer) return res.status(400).json({ error: "Angiv sagsnummer" });
      const key = normSag(sagsnummer);
      await redis.hdel(hashKey, key);
      // Slet også den tilhørende session
      await redis.del("session:" + user.firmaId + ":" + key);
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
