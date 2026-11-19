/**
 * Playrain — "Segnalati": i giochi gia' usciti che si stanno facendo notare.
 *
 * Prima il calcolo stava nella pagina, che per farlo scaricava tutto
 * history.json: 11 MB di storico a ogni visita, quando alla fine si mostrano
 * nove schede. Ora lo fa il giro notturno e la pagina legge solo il risultato,
 * segnalati.json, che pesa pochi KB. history.json resta nel repository perche'
 * serve a questo script, ma il visitatore non lo scarica piu'.
 *
 * Come si decide che un titolo "cresce" (verificato sui dati del 19 novembre):
 *
 * 1. I valori di popularity_primitives sono quote quantizzate: si contano in
 *    unita' (il primo percentile di ogni metrica) e un movimento si giudica come
 *    un conteggio. Da a a b e' credibile se la differenza supera di parecchio lo
 *    scarto atteso, che cresce come la radice: z = (b - a) / sqrt(a + b).
 *    Servono una base minima di BASE_MIN unita' e z >= Z_MIN.
 *
 * 2. Il picco dell'uscita non conta. Ogni gioco riceve visite nei giorni del
 *    lancio: e' normale, non e' un fenomeno. Il 19 novembre, a finestra di 7
 *    giorni, 6 segnalati su 9 erano usciti dentro la finestra e stavano solo
 *    facendo il loro lancio. Ora il punto di partenza deve cadere almeno
 *    DOPO_LANCIO giorni dopo l'uscita: si misura la crescita di un gioco gia'
 *    uscito, non il suo debutto.
 *
 * 3. Deve crescere adesso. Un titolo salito e gia' in discesa non "sta
 *    diventando" niente: l'ultimo valore deve restare almeno all'80% del massimo
 *    toccato nella finestra.
 *
 * 4. "hypes" (m = 0) e' l'attesa raccolta prima dell'uscita: dopo non si muove,
 *    e non dice niente su chi gioca adesso. Escluso.
 *
 * 5. Una serie si confronta solo con se stessa e nella stessa metrica: quando il
 *    gioco esce, il numero seguito puo' passare da "quanti lo vogliono" a "quanti
 *    ci giocano", e confrontare i due inventerebbe un'impennata.
 */

const BASE_MIN = 10;
const Z_MIN = 2.5;
const DOPO_LANCIO = 2;
const TENUTA = 0.8;
export const FINESTRE = [7, 14];

const giorno = (s) => Date.parse(s + "T00:00:00Z");
const piuGiorni = (s, n) => new Date(giorno(s) + n * 86400000).toISOString().slice(0, 10);

/* Il tratto finale della serie con la stessa metrica dell'ultimo punto. */
function tratto(h) {
  if (!h || !h.length) return [];
  const m = h[h.length - 1].m;
  let i = h.length - 1;
  while (i > 0 && h[i - 1].m === m) i--;
  return h.slice(i);
}
function durata(h) {
  const r = tratto(h);
  return r.length < 2 ? 0 : Math.round((giorno(r[r.length - 1].d) - giorno(r[0].d)) / 86400000);
}

function quanti(storico) {
  const v = {};
  for (const serie of Object.values(storico))
    for (const e of serie) if (e.f > 0) (v[e.m] ||= []).push(e.f);
  const q = {};
  for (const [m, a] of Object.entries(v)) {
    a.sort((x, y) => x - y);
    /* Il primo percentile invece del minimo: un solo valore anomalo verso il
       basso gonfierebbe tutti i conteggi di quella metrica. */
    q[m] = a[Math.floor(a.length * 0.01)] || a[0];
  }
  return q;
}

function percentile(ordinati, v) {
  if (!ordinati?.length) return 0;
  let lo = 0, hi = ordinati.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ordinati[mid] < v) lo = mid + 1; else hi = mid; }
  return Math.round((lo / ordinati.length) * 100);
}

/**
 * giochi: gli stessi oggetti scritti in data.json ({igdb, date, ...}).
 * storico: history.json gia' aggiornato.
 * oggi: "AAAA-MM-GG".
 */
export function calcolaSegnalati(giochi, storico, oggi) {
  const q = quanti(storico);
  const usciti = giochi.filter((g) => g.date && g.date < oggi && storico[String(g.igdb)]?.length >= 2);
  const out = { generated: oggi, metodo: { BASE_MIN, Z_MIN, DOPO_LANCIO, TENUTA } };

  for (const W of FINESTRE) {
    const misurabili = [];
    for (const g of usciti) {
      const r = tratto(storico[String(g.igdb)]);
      if (r.length < 2) continue;
      const last = r[r.length - 1];
      const cut = piuGiorni(last.d, -W);
      let prev = null;
      for (let i = r.length - 2; i >= 0; i--) if (r[i].d <= cut) { prev = r[i]; break; }
      if (!prev || !prev.f) continue;
      misurabili.push({ g, r, prev, last });
    }

    /* Il percentile mostrato nella scheda si calcola su tutti i titoli
       misurabili: dice dove stava e dove sta il gioco rispetto al catalogo. */
    const dist = {};
    for (const o of misurabili) (dist[o.last.m] ||= []).push(o.last.f);
    for (const a of Object.values(dist)) a.sort((x, y) => x - y);

    const pronti = [];
    for (const { g, r, prev, last } of misurabili) {
      if (last.m === 0) continue;
      if (prev.d < piuGiorni(g.date, DOPO_LANCIO)) continue;
      const u = q[last.m];
      if (!u) continue;
      const a = prev.f / u, b = last.f / u;
      if (a < BASE_MIN || b <= a) continue;
      const finestra = r.filter((e) => e.d >= prev.d);
      const massimo = Math.max(...finestra.map((e) => e.f));
      if (last.f < TENUTA * massimo) continue;
      const z = (b - a) / Math.sqrt(a + b);
      if (z < Z_MIN) continue;
      pronti.push({
        igdb: g.igdb,
        z: Math.round(z * 10) / 10,
        pct: Math.round(((last.f - prev.f) / prev.f) * 1000) / 10,
        m: last.m,
        pPrev: percentile(dist[last.m], prev.f),
        pLast: percentile(dist[last.m], last.f),
        /* Barre del grafico gia' normalizzate 0-100: alla pagina non serve il
           valore grezzo, che e' una quota senza unita' leggibile. */
        spark: (() => {
          const v = finestra.map((e) => e.f);
          const mx = Math.max(...v), mn = Math.min(...v), sp = Math.max(1e-12, mx - mn);
          return v.map((x) => Math.round(((x - mn) / sp) * 88) + 12);
        })(),
      });
    }
    pronti.sort((x, y) => y.z - x.z);

    const parziali = usciti
      .map((g) => [g.igdb, durata(storico[String(g.igdb)])])
      .filter(([, s]) => s < W)
      .sort((x, y) => y[1] - x[1]);
    const piuLungo = usciti.reduce((mx, g) => Math.max(mx, durata(storico[String(g.igdb)])), 0);

    /* Della lista "dati in raccolta" la pagina mostra una manciata di nomi e il
       totale: bastano i piu' vicini a completare la finestra. */
    out["w" + W] = { top: pronti.slice(0, 40), parziali: parziali.slice(0, 60), parzialiN: parziali.length,
                     piuLungo, misurabili: misurabili.length };
    console.log(`segnalati ${W} gg: ${pronti.length} su ${misurabili.length} misurabili` +
      (pronti.length ? ` — in testa: ${pronti.slice(0, 3).map((p) => giochi.find((g) => g.igdb === p.igdb)?.t).join(", ")}` : ""));
  }
  return out;
}
