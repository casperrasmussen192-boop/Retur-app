// api/login.js
// Brugeren sender email + password. Vi tjekker mod databasen og returnerer et JWT.

import bcrypt from "bcryptjs";
import { kv } from "@vercel/kv";
import { signToken } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email og adgangskode påkrævet" });

  // Hent bruger fra Vercel KV (nøgle-værdi database)
  const user = await kv.get(`user:${email.toLowerCase()}`);
  if (!user) return res.status(401).json({ error: "Forkert email eller adgangskode" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Forkert email eller adgangskode" });

  const token = signToken({
    userId: user.id,
    email: user.email,
    active: user.active,
    plan: user.plan,
  });

  return res.status(200).json({ token, email: user.email, plan: user.plan });
}
