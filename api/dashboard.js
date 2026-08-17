// api/dashboard.js
// Aggregerer data fra sager + historik til et admin-overblik
// Kun tilgængeligt for admins

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

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
  if (user.rolle !== "admin") return res.status(403).json({ error: "Kun administratorer har adgang" });
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    // ── Hent alle sager for firmaet ──
    const sagerHash = await redis.hgetall("firma:" + user.firmaId + ":sager");
    const alleSager = Object.values(sagerHash || {}).map(v => typeof v === "string" ? JSON.parse(v) : v);

    const aktiveSager = alleSager.filter(s => (s.status || "aktiv") === "aktiv");
    const afsluttedeSager = alleSager.filter(s => s.status === "afsluttet");
    const totalReturneringer = alleSager.reduce((sum, s) => sum + (s.returneringer || 0), 0);
    const totalOrdrer = alleSager.reduce((sum, s) => sum + (s.ordrer || 0), 0);
    const totalEnheder = alleSager.reduce((sum, s) => sum + (s.enheder || 0), 0);

    // ── Hent seneste hændelser på tværs af de 15 mest aktive sager ──
    // (Undgår at hente historik for ALLE sager hvis der er mange — begræns til de nyeste)
    const nyesteSager = [...alleSager]
      .sort((a, b) => (b.sidstOpdateretTs || 0) - (a.sidstOpdateretTs || 0))
      .slice(0, 15);

    const alleHændelser = [];
    for (const sag of nyesteSager) {
      const key = "firma:" + user.firmaId + ":historik:" + sag.sagsnummer.toUpperCase();
      const raw = await redis.lrange(key, 0, 4); // seneste 5 pr. sag er nok
      const hændelser = (raw || []).map(r => {
        const h = typeof r === "string" ? JSON.parse(r) : r;
        return { ...h, sagsnummer: sag.sagsnummer };
      });
      alleHændelser.push(...hændelser);
    }
    alleHændelser.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const senesteAktivitet = alleHændelser.slice(0, 20);

    // ── Aktivitet pr. montør (baseret på hvem der udførte hændelserne) ──
    const pr_montoer = {};
    for (const h of alleHændelser) {
      const navn = h.udførtAf || "Ukendt";
      if (!pr_montoer[navn]) pr_montoer[navn] = { navn, analyser: 0, returneringer: 0 };
      if (h.type === "analyse") pr_montoer[navn].analyser++;
      if (h.type === "retur") pr_montoer[navn].returneringer++;
    }
    const montoerStats = Object.values(pr_montoer).sort((a, b) =>
      (b.analyser + b.returneringer) - (a.analyser + a.returneringer)
    );

    return res.status(200).json({
      nøgletal: {
        aktiveSager: aktiveSager.length,
        afsluttedeSager: afsluttedeSager.length,
        totalSager: alleSager.length,
        totalOrdrer,
        totalEnheder,
        totalReturneringer,
      },
      senesteAktivitet,
      montoerStats,
      mestAktiveSager: [...alleSager]
        .sort((a, b) => (b.returneringer || 0) - (a.returneringer || 0))
        .slice(0, 5),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
