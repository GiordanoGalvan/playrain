#!/usr/bin/env node
/**
 * Playrain — avvisi via mail, dopo il giro notturno.
 *
 * Legge cambi.json (scritto da sync.mjs) e manda a chi segue quei giochi:
 *   - "esce oggi"         se ha attivo l'avviso di uscita;
 *   - "data cambiata"     se ha attivo l'avviso di cambio data (spostata o fissata).
 * Una mail sola per persona e per giorno, con dentro tutto quello che la
 * riguarda, nella sua lingua. Ogni mail ha il link di disiscrizione con un clic.
 *
 * Variabili d'ambiente (segreti del repository GitHub):
 *   SUPABASE_URL           https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY   chiave "service_role" (solo qui, mai nella pagina)
 *   BREVO_API_KEY          chiave API di Brevo per l'invio
 *   MAIL_FROM              es. avvisi@playrain.eu (dominio verificato su Brevo)
 *   PLAYRAIN_SITO          es. https://playrain.eu/
 * Se manca qualcosa lo script lo dice e termina senza errore: gli avvisi non
 * sono ancora attivi, e il giro dei dati non deve fallire per questo.
 *   NOTIFY_DRY=1           stampa le mail invece di mandarle.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const env = process.env;
const DRY = env.NOTIFY_DRY === "1";
const SITO = (env.PLAYRAIN_SITO || "https://playrain.it/").replace(/\/?$/, "/");

const mancano = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", ...(DRY ? [] : ["BREVO_API_KEY", "MAIL_FROM"])].filter((k) => !env[k]);
if (mancano.length) {
  console.log(`avvisi non attivi: mancano ${mancano.join(", ")}. Nessuna mail inviata.`);
  process.exit(0);
}

const cambi = JSON.parse(await readFile(path.join(ROOT, "cambi.json"), "utf8"));
/* Una volta sola al giorno: se il giro viene ripetuto (a mano o per un nuovo
   tentativo) gli avvisi di quel giorno sono gia' partiti. avvisi.json lo
   ricorda e il workflow lo salva nel repository. */
const REGISTRO = path.join(ROOT, "avvisi.json");
let registro = {};
try { registro = JSON.parse(await readFile(REGISTRO, "utf8")); } catch {}
if (!DRY && registro.inviati === cambi.generated) {
  console.log(`avvisi: gia' inviati per il ${cambi.generated}, salto.`);
  process.exit(0);
}
const dati = JSON.parse(await readFile(path.join(ROOT, "data.json"), "utf8"));
const giochi = new Map(dati.games.map((g) => [g.igdb, g]));

const uscite = new Set(cambi.uscite || []);
const date = new Map((cambi.date || []).map((c) => [c.igdb, c]));
const ids = [...new Set([...uscite, ...date.keys()])];
if (!ids.length) {
  console.log("avvisi: nessuna uscita o data cambiata oggi.");
  if (!DRY) await writeFile(REGISTRO, JSON.stringify({ inviati: cambi.generated, mail: 0 }) + "\n");
  process.exit(0);
}

const r = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/notify_targets", {
  method: "POST",
  headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ ids }),
});
if (!r.ok) throw new Error(`notify_targets: HTTP ${r.status} ${await r.text()}`);
const righe = await r.json();

/* Una persona, una mail. */
const perPersona = new Map();
for (const x of righe) {
  const p = perPersona.get(x.email) || { email: x.email, lang: x.lang, token: x.unsub_token, esce: [], cambia: [] };
  const g = giochi.get(x.igdb);
  if (!g) continue;
  if (uscite.has(x.igdb) && x.notify_release) p.esce.push(g);
  if (date.has(x.igdb) && x.notify_change) p.cambia.push({ g, c: date.get(x.igdb) });
  perPersona.set(x.email, p);
}

const MESI = {
  it: ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};
const PIATT = { pc: "PC", switch2: "Switch 2", ps5: "PS5", xbox: "Xbox" };
const data = (s, L) => {
  if (!s) return L === "en" ? "to be announced" : "da definire";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const [y, m, d] = s.split("-").map(Number);
  return L === "en" ? `${MESI.en[m - 1]} ${d}, ${y}` : `${d} ${MESI.it[m - 1]} ${y}`;
};
const html = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function componi(p) {
  const L = p.lang === "en" ? "en" : "it";
  const disiscr = SITO + "#unsub=" + p.token;
  const righeT = [], righeH = [];
  if (p.esce.length) {
    righeT.push(L === "en" ? "Out today:" : "Esce oggi:");
    righeH.push(`<h3 style="margin:18px 0 6px">${L === "en" ? "Out today" : "Esce oggi"}</h3><ul>`);
    for (const g of p.esce) {
      const pl = (g.plat || []).map((x) => PIATT[x]).join(", ");
      const link = g.links?.[0]?.u || SITO;
      righeT.push(`• ${g.t} (${pl}) — ${link}`);
      righeH.push(`<li><a href="${html(link)}">${html(g.t)}</a> <span style="color:#666">(${html(pl)})</span></li>`);
    }
    righeH.push("</ul>");
  }
  if (p.cambia.length) {
    if (righeT.length) righeT.push("");
    righeT.push(L === "en" ? "Date changes:" : "Date cambiate:");
    righeH.push(`<h3 style="margin:18px 0 6px">${L === "en" ? "Date changes" : "Date cambiate"}</h3><ul>`);
    for (const { g, c } of p.cambia) {
      const txt = c.tipo === "fissa"
        ? (L === "en" ? `now has a date: ${data(c.a, L)}` : `ha una data: ${data(c.a, L)}`)
        : (L === "en" ? `moved from ${data(c.da, L)} to ${data(c.a, L)}` : `spostato dal ${data(c.da, L)} al ${data(c.a, L)}`);
      righeT.push(`• ${g.t}: ${txt} — ${SITO}#d=${c.a}`);
      righeH.push(`<li><a href="${html(SITO + "#d=" + c.a)}">${html(g.t)}</a>: ${html(txt)}</li>`);
    }
    righeH.push("</ul>");
  }
  const n = p.esce.length + p.cambia.length;
  const oggetto = L === "en"
    ? (p.esce.length && !p.cambia.length ? `Out today: ${p.esce.map((g) => g.t).slice(0, 2).join(", ")}${p.esce.length > 2 ? "…" : ""}` : `Playrain: ${n} update${n > 1 ? "s" : ""} on games you follow`)
    : (p.esce.length && !p.cambia.length ? `Esce oggi: ${p.esce.map((g) => g.t).slice(0, 2).join(", ")}${p.esce.length > 2 ? "…" : ""}` : `Playrain: ${n} novità sui giochi che segui`);
  const piede = L === "en"
    ? `You receive this because you follow these games on Playrain. Stop alerts with one click: ${disiscr}`
    : `Ricevi questa mail perché segui questi giochi su Playrain. Per non ricevere più avvisi, un clic: ${disiscr}`;
  return {
    oggetto,
    testo: [...righeT, "", SITO, "", piede, "", (L === "en" ? "Data" : "Dati") + ": IGDB.com"].join("\n"),
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:560px">` +
      `<p style="font-size:20px;font-weight:bold;margin:0 0 8px">Playrain</p>${righeH.join("")}` +
      `<p style="margin-top:22px"><a href="${html(SITO)}">${html(SITO)}</a></p>` +
      `<p style="font-size:12px;color:#777;margin-top:22px">${html(piede.replace(disiscr, ""))}<a href="${html(disiscr)}">${L === "en" ? "Unsubscribe" : "Disiscriviti"}</a></p>` +
      `<p style="font-size:12px;color:#777">${L === "en" ? "Data" : "Dati"}: IGDB.com</p></div>`,
    disiscr,
  };
}

let inviate = 0, saltate = 0, errori = 0;
for (const p of perPersona.values()) {
  if (!p.esce.length && !p.cambia.length) { saltate++; continue; }
  const m = componi(p);
  /* I registri delle Actions di un repository pubblico sono pubblici: la mail
     del destinatario non si stampa mai, nemmeno in prova. */
  if (DRY) { console.log(`--- a ${p.email.replace(/^(.).*(@.*)$/, "$1***$2")}\nOggetto: ${m.oggetto}\n${m.testo.replace(/#unsub=[\w-]+/g, "#unsub=…")}\n`); inviate++; continue; }
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: "Playrain", email: env.MAIL_FROM },
      to: [{ email: p.email }],
      subject: m.oggetto,
      textContent: m.testo,
      htmlContent: m.html,
      headers: { "List-Unsubscribe": `<${m.disiscr}>` },
      tags: ["avvisi"],
    }),
  });
  if (res.ok) inviate++;
  else { errori++; if (errori <= 3) console.warn(`invio fallito: HTTP ${res.status} ${await res.text()}`); }
  /* Brevo regge molto di piu', ma non serve correre. */
  await new Promise((ok) => setTimeout(ok, 120));
}
if (!DRY && (inviate || !errori)) await writeFile(REGISTRO, JSON.stringify({ inviati: cambi.generated, mail: inviate }) + "\n");
console.log(`avvisi: ${inviate} mail inviate, ${saltate} senza novità, ${errori} errori (giochi coinvolti: ${ids.length})`);
if (errori && !inviate) process.exit(1);
