// api/login.js
import { Redis } from "@upstash/redis";
import bcrypt from "bcryptjs";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Udfyld email og adgangskode" });
  }

  const emailKey = "bruger:" + email.toLowerCase().trim();
  const brugerRaw = await redis.get(emailKey);
  if (!brugerRaw) {
    return res.status(401).json({ error: "Forkert email eller adgangskode" });
  }
  const bruger = typeof brugerRaw === "string" ? JSON.parse(brugerRaw) : brugerRaw;

  const ok = await bcrypt.compare(password, bruger.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Forkert email eller adgangskode" });
  }

  // Hent firmanavn til visning
  const firmaRaw = await redis.get("firma:" + bruger.firmaId);
  const firma = firmaRaw ? (typeof firmaRaw === "string" ? JSON.parse(firmaRaw) : firmaRaw) : null;

  // Token indeholder nu firmaId og rolle — bruges til at afgøre adgang og datafiltrering
  const tokenPayload = {
    email: bruger.email,
    navn: bruger.navn,
    firmaId: bruger.firmaId,
    rolle: bruger.rolle,
    firmaNavn: firma?.navn || "",
  };
  const token = Buffer.from(JSON.stringify(tokenPayload)).toString("base64");

  return res.status(200).json({ success: true, token, ...tokenPayload });
}
