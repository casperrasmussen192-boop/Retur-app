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

  // POST — generer ny invitationskode (montør eller admin)
  if (req.method === "POST") {
    const { rolle } = req.body || {};
    const inviteRolle = rolle === "admin" ? "admin" : "montoer";
    const kode = genKode();
    const invite = {
      firmaId: user.firmaId,
      oprettetAf: user.email,
      oprettet: new Date().toISOString(),
      rolle: inviteRolle,
    };
    // Koden udløber efter 7 dage hvis den ikke bruges
    await redis.set("invite:" + kode, JSON.stringify(invite), { ex: 7 * 24 * 60 * 60 });
    return res.status(200).json({ success: true, kode, rolle: inviteRolle });
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

  // PATCH — forfrem en montør til admin (eller degrader en admin til montør)
  if (req.method === "PATCH") {
    const { email, rolle } = req.body || {};
    if (!email || !rolle) return res.status(400).json({ error: "Angiv email og rolle" });
    if (!["admin", "montoer"].includes(rolle)) return res.status(400).json({ error: "Ugyldig rolle" });
    if (email.toLowerCase() === user.email.toLowerCase()) {
      return res.status(400).json({ error: "Du kan ikke ændre din egen rolle" });
    }
    const targetKey = "bruger:" + email.toLowerCase();
    const raw = await redis.get(targetKey);
    if (!raw) return res.status(404).json({ error: "Bruger findes ikke" });
    const target = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (target.firmaId !== user.firmaId) return res.status(403).json({ error: "Brugeren tilhører ikke jeres virksomhed" });
    target.rolle = rolle;
    await redis.set(targetKey, JSON.stringify(target));
    return res.status(200).json({ success: true });
  }

  // DELETE — fjern en bruger fra firmaet
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
