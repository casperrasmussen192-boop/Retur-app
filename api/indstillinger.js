// api/indstillinger.js
// Firmaets egne indstillinger — timepris og modtager-email pr. leverandør (bdEmail, aoEmail).
// Alle i firmaet kan læse (bruges af sendRetur/dashboard), kun admin kan ændre.

import { Redis } from "@upstash/redis";
import { verifyToken } from "./_auth.js";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// bdEmail/aoEmail er de oprindelige felter; returmail til alle andre grossister ligger i "emails" ({ NØGLE: adresse }).
const STANDARD = { timepris: 700, bdEmail: "", aoEmail: "", emails: {} };

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
      const { timepris, bdEmail, aoEmail, emails } = req.body || {};
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
      if (aoEmail !== undefined) {
        nye.aoEmail = String(aoEmail).trim();
      }
      if (emails && typeof emails === "object" && !Array.isArray(emails)) {
        const samlet = { ...(nye.emails || {}) };
        for (const [nøgle, adresse] of Object.entries(emails).slice(0, 100)) {
          const k = String(nøgle).toUpperCase().replace(/[^A-ZÆØÅÜÖ0-9]/g, "").slice(0, 20);
          if (!k) continue;
          const a = String(adresse || "").trim().slice(0, 120);
          if (a) samlet[k] = a; else delete samlet[k];
        }
        nye.emails = samlet;
      }
      await redis.set(key, JSON.stringify(nye));
      return res.status(200).json({ success: true, indstillinger: nye });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
