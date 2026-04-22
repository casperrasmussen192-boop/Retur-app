// api/register.js
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
  if (!email.includes("@"))
    return res.status(400).json({ error: "Ugyldig email" });
  if (password.length < 8)
    return res.status(400).json({ error: "Adgangskode skal være mindst 8 tegn" });

  const key = `user:${email.toLowerCase()}`;
  const existing = await redis.get(key);
  if (existing)
    return res.status(409).json({ error: "Email er allerede i brug" });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    email: email.toLowerCase(),
    passwordHash,
    active: true,
    plan: "trial",
    createdAt: new Date().toISOString(),
  };

  await redis.set(key, JSON.stringify(user));

  const token = Buffer.from(JSON.stringify({
    email: user.email, active: true, plan: user.plan, ts: Date.now(),
  })).toString("base64");

  return res.status(201).json({ token, email: user.email, plan: user.plan });
}
