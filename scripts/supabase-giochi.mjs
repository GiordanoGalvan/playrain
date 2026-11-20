#!/usr/bin/env node
/**
 * Playrain — carica su Supabase i giochi con data precisa (tabella "games").
 *
 * Servono al calendario personale: la Edge Function "calendario" unisce i giochi
 * seguiti da un utente con le loro date di questa tabella. Gira ogni notte dopo
 * sync.mjs, cosi' una data che slitta su IGDB si sposta anche nel calendario
 * dell'utente.
 *
 * Si caricano i giochi con data da un anno fa in avanti; quelli che non hanno
 * piu' una data precisa (o sono usciti dal catalogo) vengono tolti.
 *
 * Variabili: SUPABASE_URL, SUPABASE_SERVICE_KEY. Se mancano, lo script lo dice
 * e termina senza errore.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.log("giochi su Supabase: mancano SUPABASE_URL o SUPABASE_SERVICE_KEY, salto.");
  process.exit(0);
}

const d = JSON.parse(await readFile(path.join(ROOT, "data.json"), "utf8"));
const oggi = d.generated;
const daQuando = new Date(Date.parse(oggi + "T00:00:00Z") - 365 * 86400000).toISOString().slice(0, 10);
const righe = d.games
  .filter((g) => g.igdb && g.date && g.date >= daQuando)
  .map((g) => ({ igdb: g.igdb, titolo: g.t, data: g.date, piattaforme: (g.plat || []).join(","), aggiornato: oggi }));

const base = SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/games";
const h = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: "Bearer " + SUPABASE_SERVICE_KEY,
  "Content-Type": "application/json",
};

for (let i = 0; i < righe.length; i += 1000) {
  const r = await fetch(base + "?on_conflict=igdb", {
    method: "POST",
    headers: { ...h, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(righe.slice(i, i + 1000)),
  });
  if (!r.ok) throw new Error(`games: HTTP ${r.status} ${await r.text()}`);
}

/* Via quelli non toccati in questo giro: data tolta, gioco escluso o sparito.
   Solo se il caricamento e' andato a buon fine e non e' sospettosamente vuoto. */
let tolti = 0;
if (righe.length > 100) {
  const r = await fetch(base + "?aggiornato=lt." + oggi, { method: "DELETE", headers: { ...h, Prefer: "return=representation" } });
  if (!r.ok) throw new Error(`games (pulizia): HTTP ${r.status} ${await r.text()}`);
  tolti = (await r.json()).length;
}
console.log(`giochi su Supabase: ${righe.length} caricati, ${tolti} tolti`);
