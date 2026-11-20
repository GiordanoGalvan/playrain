// Playrain — calendario personale (.ics) di un utente.
//
//   https://<progetto>.supabase.co/functions/v1/calendario?t=<calendar_token>
//
// Lo leggono Google Calendar, il Calendario di iPhone e Outlook quando l'utente
// lo aggiunge "da URL": loro non mandano intestazioni di accesso, per questo la
// funzione va pubblicata con "Verify JWT" spento. La protezione e' il codice
// segreto nell'indirizzo, che l'utente puo' rigenerare.
//
// Nessuna dipendenza: chiama la funzione SQL calendario_utente() con la chiave
// pubblica del progetto, che Supabase mette a disposizione della funzione.

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SITO = "https://playrain.it/";
const PIATT: Record<string, string> = { pc: "PC", switch2: "Switch 2", ps5: "PS5", xbox: "Xbox" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const esc = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// RFC 5545: righe al massimo di 75 ottetti, continuate con uno spazio.
function piega(riga: string): string {
  const b = new TextEncoder().encode(riga);
  if (b.length <= 75) return riga;
  const out: string[] = [];
  let i = 0, primo = true;
  while (i < b.length) {
    let n = primo ? 75 : 74;
    while (i + n < b.length && (b[i + n] & 0xc0) === 0x80) n--;
    out.push((primo ? "" : " ") + new TextDecoder().decode(b.subarray(i, i + n)));
    i += n; primo = false;
  }
  return out.join("\r\n");
}
const compatta = (d: string) => d.replace(/-/g, "");
const dopo = (d: string) => new Date(Date.parse(d + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);

function calendario(righe: { igdb: number; titolo: string; data: string; piattaforme: string; lang: string }[], vuoto: boolean) {
  const en = righe[0]?.lang === "en";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const eventi = righe.map((g) => {
    const piatt = g.piattaforme.split(",").filter(Boolean).map((p) => PIATT[p] || p).join(", ");
    const pagina = SITO + "#d=" + g.data;
    return [
      "BEGIN:VEVENT",
      `UID:igdb-${g.igdb}@playrain`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compatta(g.data)}`,
      `DTEND;VALUE=DATE:${compatta(dopo(g.data))}`,
      `SUMMARY:${esc(g.titolo + (piatt ? " — " + piatt : ""))}`,
      `DESCRIPTION:${esc((en ? "Release on " : "Uscita su ") + (piatt || "—") + ". " + pagina)}`,
      `URL:${pagina}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    ].map(piega).join("\r\n");
  });
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Playrain//I miei giochi//IT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    piega("X-WR-CALNAME:" + esc(en || vuoto ? "Playrain — my games" : "Playrain — i miei giochi")),
    "X-WR-TIMEZONE:Europe/Rome",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
    ...eventi,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

Deno.serve(async (req) => {
  const t = new URL(req.url).searchParams.get("t") || "";
  if (!UUID.test(t)) return new Response("Indirizzo del calendario non valido.\n", { status: 404 });
  const r = await fetch(URL_BASE + "/rest/v1/rpc/calendario_utente", {
    method: "POST",
    headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ t }),
  });
  if (!r.ok) return new Response("Calendario non disponibile, riprova piu' tardi.\n", { status: 503 });
  const righe = await r.json();
  righe.sort((a: { data: string }, b: { data: string }) => a.data.localeCompare(b.data));
  // Un indirizzo inesistente e un utente che non segue niente rispondono allo
  // stesso modo (calendario vuoto): cosi' non si puo' sondare quali codici esistono.
  return new Response(calendario(righe, !righe.length), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="playrain.ics"',
      "Cache-Control": "private, max-age=900",
    },
  });
});
