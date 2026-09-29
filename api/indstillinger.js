// api/indstillinger.js
// Firmaets egne indstillinger — timepris og BD-modtager-email.
// Alle i firmaet kan læse (bruges af sendRetur/dashboard), kun admin kan ændre.

import { Redis } from "@upstash/redis";
import { verifyToken } from "./_auth.js";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const STANDARD = { timepris: 700, bdEmail: "" };

export default async function handler(req, res) {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: "Ikke logget ind" });

  const key = "firma:" + user.firmaId + ":indstillinger";

  if (req.method === "GET") {
    try {
      const raw = await redis.get(key);
      const gemt = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
      return res.status(200).json({ indstillinger: { ...STANDARD, ...gemt } });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "PATCH") {
    if (user.rolle !== "admin") return res.status(403).json({ error: "Kun administratorer kan ændre indstillinger" });
    try {
      const { timepris, bdEmail } = req.body || {};
      const raw = await redis.get(key);
      const gemt = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
      const nye = { ...STANDARD, ...gemt };
      if (timepris !== undefined) {
        const tal = Number(timepris);
        if (!Number.isFinite(tal) || tal < 0) return res.status(400).json({ error: "Ugyldig timepris" });
        nye.timepris = tal;
      }
      if (bdEmail !== undefined) {
        nye.bdEmail = String(bdEmail).trim();
      }
      await redis.set(key, JSON.stringify(nye));
      return res.status(200).json({ success: true, indstillinger: nye });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
