// api/invite.js
// Admin genererer invitationskoder til montører, og kan se/fjerne brugere i firmaet

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

function genKode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // undgår forvekslelige tegn
  let kode = "";
  for (let i = 0; i < 6; i++) kode += chars[Math.floor(Math.random() * chars.length)];
  return kode;
}

export default async function handler(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Ikke logget ind" });
  if (user.rolle !== "admin") return res.status(403).json({ error: "Kun administratorer kan gøre dette" });

  // POST — generer ny invitationskode
  if (req.method === "POST") {
    const kode = genKode();
    const invite = {
      firmaId: user.firmaId,
      oprettetAf: user.email,
      oprettet: new Date().toISOString(),
    };
    // Koden udløber efter 7 dage hvis den ikke bruges
    await redis.set("invite:" + kode, JSON.stringify(invite), { ex: 7 * 24 * 60 * 60 });
    return res.status(200).json({ success: true, kode });
  }

  // GET — liste over brugere i firmaet
  if (req.method === "GET") {
    const emails = await redis.smembers("firma:" + user.firmaId + ":brugere");
    const brugere = [];
    for (const email of emails || []) {
      const raw = await redis.get("bruger:" + email);
      if (raw) {
        const b = typeof raw === "string" ? JSON.parse(raw) : raw;
        brugere.push({ email: b.email, navn: b.navn, rolle: b.rolle, oprettet: b.oprettet });
      }
    }
    return res.status(200).json({ brugere });
  }

  // DELETE — fjern en montør fra firmaet
  if (req.method === "DELETE") {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Angiv email" });
    if (email.toLowerCase() === user.email.toLowerCase()) {
      return res.status(400).json({ error: "Du kan ikke fjerne dig selv" });
    }
    await redis.srem("firma:" + user.firmaId + ":brugere", email.toLowerCase());
    await redis.del("bruger:" + email.toLowerCase());
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
