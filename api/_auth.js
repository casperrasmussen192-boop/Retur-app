// api/_auth.js
// Deles af alle API-routes. Verificerer JWT-token fra brugerens browser.

import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET; // Sæt denne på Vercel: en lang tilfældig streng

export function verifyToken(req) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded; // { userId, email, active, plan }
  } catch {
    return null;
  }
}

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}
