-- Da incollare in Supabase -> SQL Editor -> New query -> Run.
-- Supabase mostra il risultato dell'ultima query: per vedere l'altra, selezionala e premi Run.
-- 'mail_di_accesso' conta i codici richiesti (iscrizione o accesso): ognuno e' una mail di Brevo.

-- Playrain: andamento degli ultimi 14 giorni (solo numeri, nessun dato personale)
with giorni as (
  select generate_series(current_date - 13, current_date, interval '1 day')::date as giorno
),
eventi as (
  select created_at::date as g, payload->>'action' as azione
  from auth.audit_log_entries
  where created_at >= current_date - 13
)
select
  d.giorno,
  (select count(*) from auth.users u where u.created_at::date = d.giorno)           as nuovi_iscritti,
  (select count(*) from eventi e where e.g = d.giorno and e.azione = 'login')        as accessi,
  (select count(*) from eventi e where e.g = d.giorno
     and e.azione in ('user_confirmation_requested', 'user_recovery_requested'))     as mail_di_accesso,
  (select count(*) from public.follows f where f.created_at::date = d.giorno)        as campanelle_messe
from giorni d
order by d.giorno desc;

-- Totali di oggi
select
  (select count(*) from auth.users)                                  as utenti_totali,
  (select count(*) from public.profiles
     where notify_release or notify_change)                          as con_avvisi_attivi,
  (select count(*) from public.follows)                              as campanelle_totali,
  (select count(distinct igdb) from public.follows)                  as giochi_seguiti_diversi;
