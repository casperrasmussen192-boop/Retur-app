// api/register.js
// Opretter en ny bruger. Kaldes når nogen tilmelder sig.
// I en rigtig opsætning ville du sende en bekræftelses-email og oprette en Stripe-kunde.

import bcrypt from "bcryptjs";
import { kv } from "@vercel/kv";
import { signToken } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email og adgangskode påkrævet" });

  const key = `user:${email.toLowerCase()}`;
  const existing = await kv.get(key);
  if (existing) return res.status(409).json({ error: "Email er allerede i brug" });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = {
    id: crypto.randomUUID(),
    email: email.toLowerCase(),
    passwordHash,
    active: true,       // Sæt til false hvis du vil kræve betaling før adgang
    plan: "trial",      // "trial" | "pro" | "team"
    createdAt: new Date().toISOString(),
  };

  await kv.set(key, user);

  const token = signToken({
    userId: user.id,
    email: user.email,
    active: user.active,
    plan: user.plan,
  });

  return res.status(201).json({ token, email: user.email, plan: user.plan });
}
