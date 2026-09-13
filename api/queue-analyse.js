// api/queue-analyse.js
// Starter et baggrundsjob: lægger alle uploadede filer i QStash-køen
// Browseren kan lukkes bagefter — analysen kører videre på serveren

import { Redis } from "@upstash/redis";
import { Client } from "@upstash/qstash";
import { verifyToken } from "./_auth.js";

const TTL = 7 * 24 * 60 * 60;

const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

const qstash = new Client({ token: process.env.QSTASH_TOKEN });

export default async function handler(req, res) {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: "Ikke logget ind" });

  const jobKey = (jobId) => `job:${user.firmaId}:${jobId}`;
  const countKey = (jobId) => `job:${user.firmaId}:${jobId}:færdige`;
  const fejlKey = (jobId) => `job:${user.firmaId}:${jobId}:fejlede`;
  const resultaterKey = (jobId) => `job:${user.firmaId}:${jobId}:resultater`;

  // ── POST: start et nyt job ──
  if (req.method === "POST") {
        try {
                const { jobId, sagsnummer, filer, model } = req.body;
                if (!jobId || !sagsnummer || !Array.isArray(filer) || !filer.length) {
                          return res.status(400).json({ error: "Angiv jobId, sagsnummer og filer" });
                }

          // Jobbet gemmer nu kun metadata — resultater/tæller/fejl ligger i egne nøgler,
          // så mange samtidige QStash-kald aldrig skriver til det samme objekt
          const job = {
                    jobId,
                    sagsnummer,
                    firmaId: user.firmaId,
                    startetAf: user.navn || user.email,
                    startetTs: Date.now(),
                    status: "kører",
                    model: model === "sonnet" ? "sonnet" : "haiku",
                    antalFiler: filer.length,
          };
                await redis.set(jobKey(jobId), JSON.stringify(job), { ex: TTL });

          const proto = req.headers["x-forwarded-proto"] || "https";
                const host = req.headers["x-forwarded-host"] || req.headers.host;
                const målUrl = `${proto}://${host}/api/process-fil`;

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

          for (let i = 0; i < beskeder.length; i += 100) {
                    await qstash.batchJSON(beskeder.slice(i, i + 100));
          }

          return res.status(200).json({ success: true, jobId, antalFiler: filer.length });
        } catch (err) {
                return res.status(500).json({ error: err.message });
        }
  }

  // ── GET: spørg om status på et job — samler resultaterne fra de atomare nøgler ──
  if (req.method === "GET") {
        try {
                const { jobId } = req.query;
                if (!jobId) return res.status(400).json({ error: "Angiv jobId" });

          const raw = await redis.get(jobKey(jobId));
                if (!raw) return res.status(404).json({ error: "Job ikke fundet" });
                const meta = typeof raw === "string" ? JSON.parse(raw) : raw;

          const [færdige, fejlListe, resultatListe] = await Promise.all([
                    redis.get(countKey(jobId)),
                    redis.smembers(fejlKey(jobId)),
                    redis.lrange(resultaterKey(jobId), 0, -1),
          ]);

          // Slå alle filers resultater sammen og dedupliker, ligesom før
          const ordrer = [];
                for (const rå of resultatListe || []) {
                          const filOrdrer = typeof rå === "string" ? JSON.parse(rå) : rå;
                          for (const ord of filOrdrer || []) {
                                        const eksisterende = ordrer.find(o => o.ordrenr === ord.ordrenr);
                                        if (eksisterende) {
                                                        for (const l of ord.linjer || []) {
                                                                          const dup = eksisterende.linjer.find(el =>
                                                                                              el.varenr === l.varenr && el.pos === l.pos && el.antal === l.antal && el.navn === l.navn
                                                                          );
                                                                          if (!dup) eksisterende.linjer.push(l);
                                                        }
                                        } else {
                                                        ordrer.push(ord);
                                        }
                          }
                }

          const job = {
                    ...meta,
                    færdige: Number(færdige) || 0,
                    fejlede: fejlListe || [],
                    ordrer,
          };

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
                await Promise.all([
                          redis.del(jobKey(jobId)),
                          redis.del(countKey(jobId)),
                          redis.del(fejlKey(jobId)),
                          redis.del(resultaterKey(jobId)),
                ]);
                return res.status(200).json({ success: true });
        } catch (err) {
                return res.status(500).json({ error: err.message });
        }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
