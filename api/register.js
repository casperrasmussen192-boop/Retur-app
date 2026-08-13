// api/register.js
// To måder at registrere sig på:
// 1) "opret firma" — bliver admin for en ny virksomhed
// 2) "tilmeld med kode" — bliver montør under en eksisterende virksomhed

import { Redis } from "@upstash/redis";
import bcrypt from "bcryptjs";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function genFirmaId() {
  return "f_" + Math.random().toString(36).slice(2, 10);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { mode, email, password, navn, firmaNavn, inviteKode } = req.body;

  if (!email || !password || !navn) {
    return res.status(400).json({ error: "Udfyld navn, email og adgangskode" });
  }

  const emailKey = "bruger:" + email.toLowerCase().trim();
  const eksisterende = await redis.get(emailKey);
  if (eksisterende) {
    return res.status(400).json({ error: "Der findes allerede en konto med denne email" });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // ── Mode 1: Opret ny virksomhed (bliver admin) ──
  if (mode === "firma") {
    if (!firmaNavn) return res.status(400).json({ error: "Angiv virksomhedsnavn" });

    const firmaId = genFirmaId();
    const firma = {
      firmaId,
      navn: firmaNavn,
      oprettet: new Date().toISOString(),
      adminEmail: email.toLowerCase().trim(),
    };
    await redis.set("firma:" + firmaId, JSON.stringify(firma));
    await redis.sadd("firma:" + firmaId + ":brugere", email.toLowerCase().trim());

    const bruger = {
      email: email.toLowerCase().trim(),
      navn,
      passwordHash,
      firmaId,
      rolle: "admin",
      oprettet: new Date().toISOString(),
    };
    await redis.set(emailKey, JSON.stringify(bruger));

    return res.status(200).json({ success: true, firmaId, rolle: "admin" });
  }

  // ── Mode 2: Tilmeld med invitationskode (bliver montør) ──
  if (mode === "invite") {
    if (!inviteKode) return res.status(400).json({ error: "Angiv invitationskode" });

    const inviteRaw = await redis.get("invite:" + inviteKode.toUpperCase().trim());
    if (!inviteRaw) {
      return res.status(400).json({ error: "Ugyldig eller udløbet invitationskode" });
    }
    const invite = typeof inviteRaw === "string" ? JSON.parse(inviteRaw) : inviteRaw;

    const bruger = {
      email: email.toLowerCase().trim(),
      navn,
      passwordHash,
      firmaId: invite.firmaId,
      rolle: "montoer",
      oprettet: new Date().toISOString(),
    };
    await redis.set(emailKey, JSON.stringify(bruger));
    await redis.sadd("firma:" + invite.firmaId + ":brugere", email.toLowerCase().trim());

    // Engangskode — slet efter brug
    await redis.del("invite:" + inviteKode.toUpperCase().trim());

    return res.status(200).json({ success: true, firmaId: invite.firmaId, rolle: "montoer" });
  }

  return res.status(400).json({ error: "Ugyldig registreringstype" });
}
