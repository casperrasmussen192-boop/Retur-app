// api/queue-analyse.js
// Starter et baggrundsjob: lægger alle uploadede filer i QStash-køen
// Browseren kan lukkes bagefter — analysen kører videre på serveren

import { Redis } from "@upstash/redis";
import { Client } from "@upstash/qstash";

const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

const qstash = new Client({ token: process.env.QSTASH_TOKEN });

function getUser(req) {
    try {
          const auth = req.headers.authorization;
          if (!auth || !auth.startsWith("Bearer ")) return null;
          const token = auth.split(" ")[1];
          const user = JSON.parse(Buffer.from(token, "base64").toString("utf-8"));
          return user?.email && user?.firmaId ? user : null;
    } catch { return null; }
}

export default async function handler(req, res) {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: "Ikke logget ind" });

  const jobKey = (jobId) => `job:${user.firmaId}:${jobId}`;

  // ── POST: start et nyt job ──
  if (req.method === "POST") {
        try {
                const { jobId, sagsnummer, filer, model } = req.body;
                if (!jobId || !sagsnummer || !Array.isArray(filer) || !filer.length) {
                          return res.status(400).json({ error: "Angiv jobId, sagsnummer og filer" });
                }

          const job = {
                    jobId,
                    sagsnummer,
                    firmaId: user.firmaId,
                    startetAf: user.navn || user.email,
                    startetTs: Date.now(),
                    status: "kører",
                    model: model === "sonnet" ? "sonnet" : "haiku",
                    antalFiler: filer.length,
                    færdige: 0,
                    fejlede: [],
                    ordrer: [],
          };
                await redis.set(jobKey(jobId), JSON.stringify(job), { ex: 7 * 24 * 60 * 60 });

          // Byg absolut URL til det endpoint QStash skal kalde
          const proto = req.headers["x-forwarded-proto"] || "https";
                const host = req.headers["x-forwarded-host"] || req.headers.host;
                const målUrl = `${proto}://${host}/api/process-fil`;

          // Læg hver fil i køen som en separat besked
          const beskeder = filer.map((f) => ({
                    url: målUrl,
                    body: {
                                jobId,
                                firmaId: user.firmaId,
                                sagsnummer,
                                model: job.model,
                                blobUrl: f.blobUrl,
                                filnavn: f.filnavn,
                    },
                    retries: 2,
          }));

          // QStash kan tage op til 100 beskeder pr. batch-kald
          for (let i = 0; i < beskeder.length; i += 100) {
                    await qstash.batchJSON(beskeder.slice(i, i + 100));
          }

          return res.status(200).json({ success: true, jobId, antalFiler: filer.length });
        } catch (err) {
                return res.status(500).json({ error: err.message });
        }
  }

  // ── GET: spørg om status på et job ──
  if (req.method === "GET") {
        try {
                const { jobId } = req.query;
                if (!jobId) return res.status(400).json({ error: "Angiv jobId" });
                const raw = await redis.get(jobKey(jobId));
                if (!raw) return res.status(404).json({ error: "Job ikke fundet" });
                const job = typeof raw === "string" ? JSON.parse(raw) : raw;
                return res.status(200).json({ job });
        } catch (err) {
                return res.status(500).json({ error: err.message });
        }
  }

  // ── DELETE: annuller/ryd et job ──
  if (req.method === "DELETE") {
        try {
                const { jobId } = req.body;
                if (!jobId) return res.status(400).json({ error: "Angiv jobId" });
                await redis.del(jobKey(jobId));
                return res.status(200).json({ success: true });
        } catch (err) {
                return res.status(500).json({ error: err.message });
        }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
