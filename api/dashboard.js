// api/dashboard.js
// Aggregerer data fra sager + historik til et admin-overblik
// Kun tilgængeligt for admins

import { Redis } from "@upstash/redis";
import { verifyToken } from "./_auth.js";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
  const user = verifyToken(req);
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
      if (!pr_montoer[navn]) pr_montoer[navn] = { navn, analyser: 0, returneringer: 0, samletVarighedSek: 0, antalMedVarighed: 0 };
      if (h.type === "analyse") pr_montoer[navn].analyser++;
      if (h.type === "retur") {
        pr_montoer[navn].returneringer++;
        if (h.varighedSek) {
          pr_montoer[navn].samletVarighedSek += h.varighedSek;
          pr_montoer[navn].antalMedVarighed++;
        }
      }
    }
    const montoerStats = Object.values(pr_montoer).map(m => ({
      ...m,
      gnsVarighedSek: m.antalMedVarighed > 0 ? Math.round(m.samletVarighedSek / m.antalMedVarighed) : null,
    })).sort((a, b) =>
      (b.analyser + b.returneringer) - (a.analyser + a.returneringer)
    );

    // ── Sager der er analyseret, men hvor ingen retur er registreret endnu ──
    const venterPaaRetur = aktiveSager.filter(s => (s.ordrer || 0) > 0 && (s.returneringer || 0) === 0).length;

    // ── Fejlede filer de seneste 7 dage — på tværs af de hentede hændelser ──
    const SYV_DAGE = 7 * 24 * 60 * 60 * 1000;
    const fejledeSeneste7Dage = alleHændelser
      .filter(h => h.type === "analyse" && (Date.now() - (h.ts || 0)) <= SYV_DAGE)
      .reduce((sum, h) => sum + (h.fejlede || 0), 0);

    return res.status(200).json({
      nøgletal: {
        aktiveSager: aktiveSager.length,
        afsluttedeSager: afsluttedeSager.length,
        totalSager: alleSager.length,
        totalOrdrer,
        totalEnheder,
        totalReturneringer,
        venterPaaRetur,
        fejledeSeneste7Dage,
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
