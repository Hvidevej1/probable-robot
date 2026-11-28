-- Fotovagt 15.01: følg de danske akutlægehelikoptere ("Doc") live på kortet.
-- Kilde: adsb.lol (fællesskabsdrevne ADS-B-modtagere, ODbL – må bruges kommercielt med kildeangivelse).
-- Helikopterne flyves af Norsk Luftambulanse med kaldesignal DOC01–DOC09 (norske LN-registreringer).
-- Databasen henter alle fly inden for 250 sømil af Danmark hvert 3. minut (480 kald/døgn – grænsen uden nøgle er 500).
-- Med en gratis nøgle fra https://www.adsb.lol/request (1.000/døgn) gemmes den i intern.adsb_noegle
-- (Supabase → SQL Editor: update intern set adsb_noegle = '<nøglen>' where id = 1;) – så hentes der hvert 2. minut.
alter table intern add column if not exists adsb_noegle text;

create table if not exists helikoptere (
  hex text primary key,
  kaldesignal text,
  reg text,
  type text,
  lat double precision,
  lon double precision,
  hoejde_ft int,             -- null på jorden
  fart_kt numeric,
  kurs numeric,
  paa_jorden boolean not null default false,
  set timestamptz not null,  -- sidste position
  opdateret timestamptz not null default now()
);
alter table helikoptere enable row level security;
drop policy if exists heli_laes on helikoptere;
create policy heli_laes on helikoptere for select to authenticated using (er_bruger());
alter publication supabase_realtime add table helikoptere;

create table if not exists heli_koe (id int primary key default 1, req_id bigint, sendt timestamptz);
alter table heli_koe enable row level security;

create or replace function heli_hent() returns void
language plpgsql security definer set search_path = public as $$
declare k text; h jsonb := '{"User-Agent":"Fotovagt/15 https://vagt.hrc-fotos.dk"}'; m int := extract(minute from now())::int;
begin
  select adsb_noegle into k from intern where id = 1;
  -- Uden nøgle: hvert 3. minut (480 kald/døgn, grænsen er 500). Med gratis nøgle (1.000/døgn): hvert 2. minut.
  if (k is null and m % 3 <> 0) or (k is not null and m % 2 <> 0) then return; end if;
  if k is not null then h := h || jsonb_build_object('x-api-key', k); end if;
  insert into heli_koe (id, req_id, sendt)
  values (1, net.http_get('https://api.adsb.lol/v2/point/56.0/11.0/250', headers := h, timeout_milliseconds := 15000), now())
  on conflict (id) do update set req_id = excluded.req_id, sendt = now();
end $$;

create or replace function heli_saml() returns int
language plpgsql security definer set search_path = public as $$
declare r record; a jsonb; n int := 0; nu timestamptz;
begin
  select q.req_id, s.status_code, s.content into r from heli_koe q join net._http_response s on s.id = q.req_id where q.id = 1;
  if r.req_id is null or r.status_code is distinct from 200 then return 0; end if;
  nu := to_timestamp(((r.content::jsonb->>'now')::numeric) / 1000);
  for a in select x from jsonb_array_elements(r.content::jsonb->'ac') x
    where trim(x->>'flight') ~ '^DOC0[0-9]$' and (x->>'lat')::numeric between 54.4 and 57.9 and (x->>'lon')::numeric between 7.8 and 15.4
  loop
    insert into helikoptere (hex, kaldesignal, reg, type, lat, lon, hoejde_ft, fart_kt, kurs, paa_jorden, set, opdateret)
    values (a->>'hex', trim(a->>'flight'), a->>'r', a->>'t', (a->>'lat')::float8, (a->>'lon')::float8,
      case when a->>'alt_baro' ~ '^-?\d+$' then (a->>'alt_baro')::int end,
      (a->>'gs')::numeric, (a->>'track')::numeric, a->>'alt_baro' = 'ground',
      nu - make_interval(secs => coalesce((a->>'seen_pos')::numeric, 0)), now())
    on conflict (hex) do update set kaldesignal = excluded.kaldesignal, reg = coalesce(excluded.reg, helikoptere.reg),
      type = coalesce(excluded.type, helikoptere.type), lat = excluded.lat, lon = excluded.lon, hoejde_ft = excluded.hoejde_ft,
      fart_kt = excluded.fart_kt, kurs = excluded.kurs, paa_jorden = excluded.paa_jorden, set = excluded.set, opdateret = now();
    n := n + 1;
  end loop;
  -- Helikoptere, der ikke er set i 6 timer, fjernes (står på basen uden sender, eller er fløjet hjem til Norge)
  delete from helikoptere where set < now() - interval '6 hours';
  update heli_koe set req_id = null where id = 1;
  return n;
end $$;

revoke execute on function heli_hent(), heli_saml() from public, anon, authenticated;

-- Hent hvert 3. minut; saml svaret hvert minut (så positionen højst er ca. et minut gammel, når den kommer frem)
select cron.unschedule(jobname) from cron.job where jobname in ('fotovagt-heli', 'fotovagt-heli-hent', 'fotovagt-heli-saml');
select cron.schedule('fotovagt-heli-hent', '* * * * *', $$select heli_hent();$$);   -- heli_hent bestemmer selv takten
select cron.schedule('fotovagt-heli-saml', '* * * * *', $$select heli_saml();$$);
