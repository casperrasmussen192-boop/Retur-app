// api/chat.js
// Håndterer chat-spørgsmål om en analyseret sag.

import Anthropic from "@anthropic-ai/sdk";
import { verifyToken } from "./_auth.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: "Ikke logget ind" });
  if (!user.active) return res.status(403).json({ error: "Inaktivt abonnement" });

  const { message, context } = req.body;
  if (!message) return res.status(400).json({ error: "Ingen besked" });

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 800,
      system: `Du er BD Brødrene Dahls retur-assistent. Sagens data:\n${context}\nSvar kort og præcist på dansk.`,
      messages: [{ role: "user", content: message }],
    });

    const reply = response.content.map((c) => c.text || "").join("");
    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
