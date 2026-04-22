// api/login.js
import { Redis } from "@upstash/redis";
import bcrypt from "bcryptjs";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "Email og adgangskode påkrævet" });

  const key = `user:${email.toLowerCase()}`;
  const raw = await redis.get(key);

  if (!raw)
    return res.status(401).json({ error: "Forkert email eller adgangskode" });

  const user = typeof raw === "string" ? JSON.parse(raw) : raw;
  const ok = await bcrypt.compare(password, user.passwordHash);

  if (!ok)
    return res.status(401).json({ error: "Forkert email eller adgangskode" });

  const token = Buffer.from(JSON.stringify({
    email: user.email, active: user.active, plan: user.plan, ts: Date.now(),
  })).toString("base64");

  return res.status(200).json({ token, email: user.email, plan: user.plan });
}
