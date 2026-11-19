/**
 * Playrain — calendario.ics, il calendario delle uscite piu' attese.
 *
 * Si aggiunge a Google Calendar, Apple Calendario o Outlook come calendario in
 * abbonamento (URL), non come file scaricato: cosi' il programma lo ricarica da
 * solo e una data che slitta si sposta anche li'. Ogni evento ha un UID fisso
 * per gioco, quindi un cambio di data aggiorna l'evento invece di duplicarlo.
 *
 * Dentro ci sono solo le uscite con un giorno preciso e un'attesa sopra
 * SOGLIA_ATTESA: tutte le 24.000 farebbero un calendario inutilizzabile.
 */

const SOGLIA_ATTESA = 40;
const GIORNI = 180;
const PIATT = { pc: "PC", switch2: "Switch 2", ps5: "PS5", xbox: "Xbox" };
export const SITO = process.env.PLAYRAIN_SITO || "https://giordanogalvan.github.io/playrain/";

/* RFC 5545: virgole, punti e virgola e backslash vanno protetti; righe al
   massimo di 75 ottetti, continuate con uno spazio. */
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function piega(riga) {
  const b = Buffer.from(riga, "utf8");
  if (b.length <= 75) return riga;
  const parti = [];
  let i = 0, primo = true;
  while (i < b.length) {
    let n = primo ? 75 : 74;
    /* Non spezzare un carattere UTF-8 a meta'. */
    while (i + n < b.length && (b[i + n] & 0xc0) === 0x80) n--;
    parti.push((primo ? "" : " ") + b.subarray(i, i + n).toString("utf8"));
    i += n; primo = false;
  }
  return parti.join("\r\n");
}
const compatta = (d) => d.replace(/-/g, "");
const dopo = (d) => new Date(Date.parse(d + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);

export function eventoIcs(g, stamp) {
  const pagina = SITO + "#d=" + g.date;
  const piatt = (g.plat || []).map((p) => PIATT[p] || p).join(", ");
  return [
    "BEGIN:VEVENT",
    `UID:igdb-${g.igdb}@playrain`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compatta(g.date)}`,
    `DTEND;VALUE=DATE:${compatta(dopo(g.date))}`,
    `SUMMARY:${esc(g.t)}${piatt ? esc(" — " + piatt) : ""}`,
    `DESCRIPTION:${esc("Uscita su " + (piatt || "—") + ". Dati IGDB.com. " + pagina)}`,
    `URL:${pagina}`,
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
  ].map(piega).join("\r\n");
}

export function avvolgiIcs(nome, eventi) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Playrain//Uscite videogiochi//IT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    piega(`X-WR-CALNAME:${esc(nome)}`),
    "X-WR-TIMEZONE:Europe/Rome",
    "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
    "X-PUBLISHED-TTL:PT12H",
    ...eventi,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

export function calendarioIcs(giochi, oggi) {
  const fine = new Date(Date.parse(oggi + "T00:00:00Z") + GIORNI * 86400000).toISOString().slice(0, 10);
  const stamp = compatta(oggi) + "T000000Z";
  const scelti = giochi
    .filter((g) => g.date && g.date >= oggi && g.date <= fine && (g.hype || 0) >= SOGLIA_ATTESA)
    .sort((a, b) => a.date.localeCompare(b.date) || (b.hype || 0) - (a.hype || 0));
  console.log(`calendario.ics: ${scelti.length} uscite`);
  return avvolgiIcs("Playrain — uscite più attese", scelti.map((g) => eventoIcs(g, stamp)));
}
