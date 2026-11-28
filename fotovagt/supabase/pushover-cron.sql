-- Henter nye Pushover-beskeder hvert 15. sekund.
-- Kør EFTER opsaetning.sql, og efter at funktionen "pushover" er lagt op.
-- Ret RET_MIG_PROJEKT til dit projekts adresse, fx abcdefgh.supabase.co (Project Settings -> API).
-- (Fotovagts eget projekt er uhhfqojbbslfcivykcxx – allerede sat op.)
-- Hemmeligheden, som funktionen tjekker, laver databasen selv (tabellen intern).

create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.unschedule('hent-pushover') where exists (select 1 from cron.job where jobname = 'hent-pushover');
select cron.schedule('hent-pushover', '15 seconds', $$
  select net.http_post(
    url := 'https://RET_MIG_PROJEKT.supabase.co/functions/v1/pushover',
    body := '{"hent": true}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-fotovagt-secret', (select cron_secret from public.intern where id = 1)),
    timeout_milliseconds := 30000
  );
$$);

-- Ryd op i pg_net's svarlog hver nat, så databasen ikke vokser
select cron.unschedule('ryd-net-svar') where exists (select 1 from cron.job where jobname = 'ryd-net-svar');
select cron.schedule('ryd-net-svar', '17 3 * * *', $$ delete from net._http_response where created < now() - interval '1 day' $$);

-- Fotografer, der ikke har haft appen åben i 2 timer, sættes til "offline" (hvis de ikke har en opgave)
select cron.unschedule('offline-fotografer') where exists (select 1 from cron.job where jobname = 'offline-fotografer');
select cron.schedule('offline-fotografer', '*/10 * * * *', $$
  update public.profiles set status = 'offline', status_tid = now()
   where status <> 'offline' and haendelse_id is null
     and coalesce(sidst_set, status_tid) < now() - interval '2 hours'
$$);

-- Adresseopslag i databasen --------------------------------------------------------------
-- Nominatim og Photon afviser kald fra Supabases Edge Functions (delte cloud-adresser), men ikke
-- fra databasen. Hændelser med adresse og uden placering sættes i kø, og uret slår dem op
-- (højst ét opslag hvert 5. sekund, som Nominatim kræver).
create table if not exists public.geokod_koe (
  haendelse_id uuid primary key references public.haendelser on delete cascade,
  forsoeg text[] not null,                 -- søgninger, der mangler at blive prøvet
  request_id bigint,                       -- igangværende opslag (pg_net)
  oprettet timestamptz default now()
);
alter table public.geokod_koe enable row level security;

create or replace function public.url_koder(t text) returns text
language sql immutable set search_path = public as $$
  select coalesce(string_agg(case when (b between 48 and 57) or (b between 65 and 90) or (b between 97 and 122) or b in (45, 46, 95, 126)
    then chr(b) else '%' || upper(lpad(to_hex(b), 2, '0')) end, '' order by i), '')
  from (select i, get_byte(convert_to(t, 'UTF8'), i) as b
          from generate_series(0, octet_length(convert_to(t, 'UTF8')) - 1) as i) x;
$$;

create or replace function public.geokod_bestil() returns trigger
language plpgsql security definer set search_path = public as $$
declare a text := trim(coalesce(new.adresse, '')); q text[]; vej text; pb text;
begin
  if new.lat is not null or a = '' then
    delete from geokod_koe where haendelse_id = new.id;
    return new;
  end if;
  -- et gadenavn alene slås ikke op (der er mange Randersveje)
  if a !~ '[,0-9]' and a ~* '(vej|gade|allé|alle|stræde|torv|plads|boulevard)$' then return new; end if;
  q := array[a];
  vej := trim(split_part(a, ',', 1));
  if position(',' in a) > 0 and array_length(regexp_split_to_array(vej, '\s+'), 1) >= 3 and vej ~ '\d[A-Za-z]?$' then
    q := q || (regexp_replace(vej, '^\S+\s+', '') || substring(a from position(',' in a)));   -- uden firmanavn
  end if;
  pb := substring(a from '\m(\d{4}\s+[^,]+)$');
  if pb is not null and pb <> a then q := q || pb; end if;                                     -- "8000 Aarhus C"
  insert into geokod_koe (haendelse_id, forsoeg) values (new.id, q)
  on conflict (haendelse_id) do update set forsoeg = excluded.forsoeg, request_id = null, oprettet = now();
  return new;
end $$;
drop trigger if exists geokod_bestil on public.haendelser;
create trigger geokod_bestil after insert or update of adresse, lat on public.haendelser
  for each row execute function public.geokod_bestil();

create or replace function public.geokod_behandl() returns void
language plpgsql security definer set search_path = public, net as $$
declare r record; svar record; j jsonb; la double precision; lo double precision; nye int := 0;
begin
  for r in select * from geokod_koe order by oprettet loop
    if r.request_id is null then
      if nye >= 1 then continue; end if;   -- højst ét nyt opslag pr. kørsel
      update geokod_koe set request_id = net.http_get(
        url := 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=dk&accept-language=da&q=' || url_koder(r.forsoeg[1]),
        headers := jsonb_build_object('User-Agent', 'Fotovagt/1.0 (supabase database)')
      ) where haendelse_id = r.haendelse_id;
      nye := nye + 1;
      continue;
    end if;
    select * into svar from net._http_response where id = r.request_id;
    if not found then continue; end if;   -- svaret er ikke kommet endnu
    la := null; lo := null;
    if svar.status_code = 200 then
      begin j := svar.content::jsonb; exception when others then j := null; end;
      if jsonb_typeof(j) = 'array' and jsonb_array_length(j) > 0 then
        la := (j->0->>'lat')::double precision; lo := (j->0->>'lon')::double precision;
      end if;
    end if;
    if la between 54.4 and 57.9 and lo between 7.8 and 15.3 then
      update haendelser set lat = la, lon = lo where id = r.haendelse_id and lat is null;
      delete from geokod_koe where haendelse_id = r.haendelse_id;
    elsif coalesce(array_length(r.forsoeg, 1), 0) > 1 then
      update geokod_koe set forsoeg = r.forsoeg[2:], request_id = null where haendelse_id = r.haendelse_id;
    else
      delete from geokod_koe where haendelse_id = r.haendelse_id;   -- intet fundet: kontoret må placere den
    end if;
  end loop;
  delete from geokod_koe where oprettet < now() - interval '1 hour';
end $$;
revoke execute on function public.geokod_behandl(), public.geokod_bestil() from public, anon, authenticated;

select cron.unschedule('geokod') where exists (select 1 from cron.job where jobname = 'geokod');
select cron.schedule('geokod', '5 seconds', $$ select public.geokod_behandl() $$);
