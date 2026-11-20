-- Playrain — schema del database per account, campanella e avvisi via mail.
--
-- Da incollare una volta sola in Supabase: progetto -> SQL Editor -> New query
-- -> Run. Si puo' rieseguire senza danni: crea solo cio' che manca.
--
-- Principi:
--   * Minimizzazione: si salvano mail (in auth.users, gestita da Supabase),
--     giochi seguiti e due preferenze. Niente nomi, niente eta', niente IP propri.
--   * Ognuno vede e modifica solo le proprie righe (Row Level Security).
--   * La pagina usa la chiave pubblica "anon": tutto cio' che e' delicato passa
--     da funzioni con permessi limitati, mai da accessi diretti alle tabelle.
--   * Cancellare l'account cancella tutto, a cascata, subito.

-- ---------------------------------------------------------------- profili
create table if not exists public.profiles (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  notify_release boolean not null default true,
  notify_change  boolean not null default true,
  lang           text    not null default 'it' check (lang in ('it', 'en')),
  -- Gettone per la disiscrizione con un clic dal link nelle mail: non e' la
  -- sessione e non da' accesso a nient'altro.
  unsub_token    uuid    not null default gen_random_uuid() unique,
  created_at     timestamptz not null default now(),
  last_seen      date not null default current_date
);

-- ------------------------------------------------------------- giochi seguiti
create table if not exists public.follows (
  user_id    uuid not null references auth.users (id) on delete cascade,
  igdb       integer not null check (igdb > 0),
  created_at timestamptz not null default now(),
  primary key (user_id, igdb)
);
create index if not exists follows_igdb on public.follows (igdb);

alter table public.profiles enable row level security;
alter table public.follows  enable row level security;

drop policy if exists "profilo: leggo il mio" on public.profiles;
create policy "profilo: leggo il mio" on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "profilo: modifico il mio" on public.profiles;
create policy "profilo: modifico il mio" on public.profiles
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "seguiti: leggo i miei" on public.follows;
create policy "seguiti: leggo i miei" on public.follows
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "seguiti: aggiungo i miei" on public.follows;
create policy "seguiti: aggiungo i miei" on public.follows
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "seguiti: tolgo i miei" on public.follows;
create policy "seguiti: tolgo i miei" on public.follows
  for delete to authenticated using (user_id = (select auth.uid()));

-- Permessi per colonna: l'utente puo' cambiare solo preferenze e lingua, non il
-- gettone di disiscrizione ne' le date. Il profilo lo crea il trigger, non lui.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (notify_release, notify_change, lang, last_seen) on public.profiles to authenticated;
revoke all on public.follows from anon, authenticated;
grant select, insert, delete on public.follows to authenticated;

-- user_id si riempie da solo con l'utente che fa la richiesta: la pagina manda
-- solo { igdb }.
alter table public.follows alter column user_id set default auth.uid();

-- Tetto ai giochi seguiti: un account non puo' diventare un deposito.
create or replace function public.follows_limite()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.follows where user_id = new.user_id) >= 1000 then
    raise exception 'Limite di 1000 giochi seguiti raggiunto';
  end if;
  return new;
end $$;
drop trigger if exists follows_limite on public.follows;
create trigger follows_limite before insert on public.follows
  for each row execute function public.follows_limite();

-- ------------------------------------------- profilo creato all'iscrizione
create or replace function public.nuovo_utente()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, lang)
  values (new.id, case when new.raw_user_meta_data ->> 'lang' = 'en' then 'en' else 'it' end)
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists nuovo_utente on auth.users;
create trigger nuovo_utente after insert on auth.users
  for each row execute function public.nuovo_utente();

-- Ultimo accesso, per la cancellazione degli account inattivi.
create or replace function public.ultimo_accesso()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.last_sign_in_at is distinct from old.last_sign_in_at then
    update public.profiles set last_seen = current_date where user_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists ultimo_accesso on auth.users;
create trigger ultimo_accesso after update on auth.users
  for each row execute function public.ultimo_accesso();

-- --------------------------------------------- cancellazione dell'account
-- Chiamata dal pulsante "Cancella account". Cancella l'utente e, a cascata,
-- profilo e giochi seguiti.
create or replace function public.delete_me()
returns void language sql security definer set search_path = '' as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function public.delete_me() from public, anon;
grant execute on function public.delete_me() to authenticated;

-- ------------------------------------------- disiscrizione con un clic
-- Dal link nelle mail, senza dover entrare. Spegne entrambi gli avvisi.
create or replace function public.unsubscribe(t uuid)
returns void language sql security definer set search_path = '' as $$
  update public.profiles set notify_release = false, notify_change = false where unsub_token = t;
$$;
revoke all on function public.unsubscribe(uuid) from public;
grant execute on function public.unsubscribe(uuid) to anon, authenticated;

-- -------------------------------------- destinatari per il giro notturno
-- Usata solo dallo script degli avvisi, con la chiave di servizio: per una
-- lista di giochi restituisce chi li segue e vuole essere avvisato.
create or replace function public.notify_targets(ids integer[])
returns table (email text, lang text, igdb integer, notify_release boolean, notify_change boolean, unsub_token uuid)
language sql security definer set search_path = '' as $$
  select u.email::text, p.lang, f.igdb, p.notify_release, p.notify_change, p.unsub_token
  from public.follows f
  join public.profiles p on p.user_id = f.user_id
  join auth.users u on u.id = f.user_id
  where f.igdb = any (ids)
    and (p.notify_release or p.notify_change)
    and u.email_confirmed_at is not null;
$$;
revoke all on function public.notify_targets(integer[]) from public, anon, authenticated;
grant execute on function public.notify_targets(integer[]) to service_role;

-- ------------------------------------- pulizia degli account inattivi (24 mesi)
create or replace function public.pulisci_inattivi()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from auth.users u using public.profiles p
  where p.user_id = u.id and p.last_seen < current_date - interval '24 months';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.pulisci_inattivi() from public, anon, authenticated;
grant execute on function public.pulisci_inattivi() to service_role;

-- =================================================================== v2
-- Calendario personale sincronizzato (20/11/2026).
--
-- Ogni utente ha un indirizzo segreto di calendario (.ics) da aggiungere a
-- Google Calendar, iPhone o Outlook: dentro ci sono i giochi che segue, con la
-- data aggiornata ogni notte. L'indirizzo lo serve la Edge Function
-- "calendario" (supabase/functions/calendario), che chiama calendario_utente().

-- Codice segreto dell'indirizzo del calendario. Diverso dal gettone di
-- disiscrizione: chi lo conosce vede solo i titoli seguiti, e l'utente puo'
-- rigenerarlo se lo ha condiviso per errore.
alter table public.profiles
  add column if not exists calendar_token uuid not null default gen_random_uuid();
create unique index if not exists profiles_calendar_token on public.profiles (calendar_token);

-- Giochi con data precisa, caricati ogni notte da scripts/supabase-giochi.mjs con
-- la chiave di servizio. Nessun accesso diretto per anon o utenti: si leggono
-- solo attraverso calendario_utente().
create table if not exists public.games (
  igdb       integer primary key,
  titolo     text not null,
  data       date not null,
  piattaforme text not null default '',
  aggiornato date not null default current_date
);
alter table public.games enable row level security;
revoke all on public.games from anon, authenticated;

create or replace function public.calendario_utente(t uuid)
returns table (igdb integer, titolo text, data date, piattaforme text, lang text)
language sql stable security definer set search_path = '' as $$
  select g.igdb, g.titolo, g.data, g.piattaforme, p.lang
  from public.profiles p
  join public.follows f on f.user_id = p.user_id
  join public.games g on g.igdb = f.igdb
  where p.calendar_token = t;
$$;
revoke all on function public.calendario_utente(uuid) from public;
grant execute on function public.calendario_utente(uuid) to anon, authenticated, service_role;

-- "Rigenera indirizzo": il vecchio smette di funzionare subito.
create or replace function public.rigenera_calendario()
returns uuid language sql security definer set search_path = '' as $$
  update public.profiles set calendar_token = gen_random_uuid()
  where user_id = auth.uid()
  returning calendar_token;
$$;
revoke all on function public.rigenera_calendario() from public, anon;
grant execute on function public.rigenera_calendario() to authenticated;
