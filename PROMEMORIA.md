# Playrain — promemoria per la prossima sessione

Scritto il 20 novembre 2026. Stato: sito online su https://playrain.it, login attivo
(Supabase UE + Brevo), campanella, avvisi via mail, link diretti, liste da copiare,
calendario delle uscite piu' attese, pagina privacy.

---

## 1. Login in alto a destra (come in tutti i siti)

- Nella barra in alto, a destra, un pulsante **Accedi**.
- Cliccandolo si apre una finestra (pannello a comparsa) con: mail, spunta
  "ho almeno 14 anni e ho letto l'informativa", invio del codice, campo del codice.
  E' lo stesso modulo che oggi sta in fondo alla pagina, spostato.
- Dopo l'accesso, al posto di "Accedi" compare il **nome dell'utente** con un menu:
  - **Preferiti** → apre la schermata "I miei giochi" (punto 2);
  - impostazioni avvisi via mail (uscita / cambio data);
  - Scarica i miei dati, Cancella account, Esci.
- **Nome utente:** oggi l'account ha solo la mail. Da decidere:
  - mostrare la parte prima della @ (nessun dato in piu' da chiedere), oppure
  - chiedere un nome facoltativo all'iscrizione (nuova colonna `display_name` in
    `profiles`; va aggiunto all'informativa privacy).
  Consiglio: parte prima della @, modificabile dal menu se l'utente vuole.
- Su cellulare: icona utente al posto della scritta, il menu si apre a tutto schermo.

## 2. "I miei giochi" come schermata separata

- Non piu' una sezione in fondo alla pagina: una schermata propria
  (pannello a tutto schermo o vista `#preferiti`), aperta da **Preferiti**.
- Titolo **I miei giochi**, senza l'etichetta gialla "campanella".
- Elenco dei giochi seguiti: prima le date certe in ordine di uscita, poi le vaghe;
  ogni riga porta al giorno nel calendario e ha la campanella per smettere di seguire.
- Dentro c'e' il **calendario sincronizzato** (punto 3).
- La sezione in fondo alla home va tolta.

## 3. Calendario personale sincronizzato (Google Calendar, iPhone, Outlook)

Obiettivo: l'utente aggiunge una volta il suo calendario e da li' in poi i giochi
che segue compaiono e si aggiornano da soli (nuovo gioco seguito, data spostata,
gioco tolto).

**Perche' serve un pezzo nuovo:** GitHub Pages serve solo file statici uguali per
tutti; un calendario personale deve essere generato per ogni utente.

**Soluzione proposta (gratuita, dati in UE):**
1. **Tabella `games` su Supabase** (igdb, titolo, data, piattaforme), aggiornata
   ogni notte dallo script `sync.mjs` con la chiave di servizio: solo i giochi con
   data precisa, circa 24.000 righe.
2. **Colonna `calendar_token`** in `profiles`: un codice casuale e segreto per
   utente, diverso da quello di disiscrizione, rigenerabile.
3. **Edge Function Supabase `calendario`**:
   `https://rkwhittgtrkuxldfbszl.supabase.co/functions/v1/calendario?t=<token>`
   risponde con un file .ics fatto con i giochi seguiti da quell'utente (unione di
   `follows` e `games`). Stessi UID dell'ics pubblico (`igdb-<id>@playrain`), cosi'
   una data spostata aggiorna l'evento invece di duplicarlo.
4. Nella schermata "I miei giochi":
   - pulsante **Aggiungi a Google Calendar** → apre direttamente
     `https://calendar.google.com/calendar/render?cid=webcal://...` (un clic);
   - pulsante **Apple / iPhone** → link `webcal://...` (si apre il Calendario);
   - pulsante **Copia indirizzo** per Outlook e altri;
   - pulsante **Rigenera indirizzo** se l'utente lo ha condiviso per errore
     (il vecchio smette di funzionare).
5. Informativa privacy: aggiungere il calendario personale (contiene solo i titoli
   seguiti; chi ha l'indirizzo segreto puo' vederli).

Nota: Google ricarica i calendari in abbonamento ogni qualche ora (non
impostabile). Va detto all'utente: "le modifiche compaiono entro qualche ora".

Alternativa scartata: scaricare un .ics statico (quello di oggi) — non si aggiorna.

## 4. Campanella senza login

- Senza accesso, toccando la campanella **non** si salva niente: compare un
  messaggio tipo "Per aggiungere giochi ai preferiti accedi" con il pulsante
  **Accedi** che apre la finestra del punto 1.
- Conseguenze da sistemare:
  - togliere il salvataggio locale (`localStorage` "playrain-seguiti") per chi non
    e' entrato; tenere in locale solo una copia dei preferiti dell'account;
  - all'uscita svuotare l'elenco locale (risolve anche il problema segnalato il
    20/11: dopo il logout i giochi restavano nel browser);
  - togliere l'unione "elenco del browser + elenco dell'account" all'accesso,
    che non serve piu';
  - aggiornare i testi e l'informativa (niente piu' preferiti salvati nel browser
    senza account).

## 5. Altre cose aperte

- Primo avviso via mail reale da Brevo non ancora visto: arrivera' quando un gioco
  seguito esce o cambia data. Se finisce nello spam, segnalarlo come "non spam".
- Mail agli youtuber: bozze pronte nella conversazione del 19/11.
- Contenuti per adulti: esclusi per tutti (AGCOM richiede verifica dell'eta' vera).
- Dominio playrain.it: scadenza 19/11/2027, rinnovo manuale.
- IGDB: uso gratuito con attribuzione; per pubblicita'/sponsor scrivere a
  partner@igdb.com prima.

## Riferimenti tecnici

- Repository: github.com/GiordanoGalvan/playrain (Pages da `main`, dominio playrain.it)
- Supabase: progetto `rkwhittgtrkuxldfbszl`, regione eu-west-1 (Irlanda);
  schema in `supabase/schema.sql`
- Brevo: dominio playrain.it autenticato, mittente `Playrain <avvisi@playrain.it>`
- Segreti GitHub: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `BREVO_API_KEY`,
  `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`; variabili `MAIL_FROM`, `PLAYRAIN_SITO`
- Posta: `privacy@playrain.it` inoltra alla Gmail di Giordano (alias su register.it)
