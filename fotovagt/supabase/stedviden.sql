-- Stedviden: Fotovagt lærer steder at kende og bliver klogere for hver hændelse.
--  * adresse  – en adresse/stedtekst, der er fundet på kortet (fx "Uglehøjen, Højby, Odense" -> koordinater)
--  * vej      – vejnavne, også dem uden vej/gade (fx "Uglehøjen" i Højby), så de genkendes i senere beskeder
--  * station  – beredskabets station ("Åsum - Odense") -> den rigtige brandstation fra OpenStreetMap
-- Kilder: 'kontor' (kontorets rettelse – vinder altid), 'geokod' (fundet ved opslag), 'nyhed', 'osm'.
-- Kontorets rettelser (flyt nålen / ret adressen i "Ret") huskes, så samme tekst næste gang placeres rigtigt.
-- Kør i Supabase -> SQL Editor efter stationer.sql.

create table if not exists stedviden (
  noegle text primary key,                -- type:normaliseret tekst
  type text not null check (type in ('adresse', 'vej', 'station')),
  navn text not null, "by" text,
  lat double precision, lon double precision,
  kilde text not null, antal int not null default 1,
  oprettet timestamptz not null default now(), opdateret timestamptz not null default now()
);
alter table stedviden enable row level security;
drop policy if exists "laes" on stedviden;
create policy "laes" on stedviden for select to authenticated using (er_bruger());
revoke all on table stedviden from anon;

create or replace function sted_norm(t text) returns text language sql immutable as $$
  select regexp_replace(lower(coalesce(t, '')), '[^a-z0-9æøåéü]+', '', 'g') $$;

-- Lær et sted. Kontorets rettelser overskriver; andre kilder tæller kun op, hvis kontoret allerede har rettet.
create or replace function laer_sted(t text, navn text, "by" text, la double precision, lo double precision, kilde text)
returns void language plpgsql security definer set search_path = public as $$
declare k text := t || ':' || sted_norm(navn || coalesce(' ' || "by", ''));
begin
  if coalesce(trim(navn), '') = '' or length(sted_norm(navn)) < 3 then return; end if;
  insert into stedviden as s (noegle, type, navn, "by", lat, lon, kilde)
  values (k, t, trim(navn), nullif(trim("by"), ''), la, lo, kilde)
  on conflict (noegle) do update set
    antal = s.antal + 1, opdateret = now(),
    lat = case when excluded.kilde = 'kontor' or s.kilde <> 'kontor' then coalesce(excluded.lat, s.lat) else s.lat end,
    lon = case when excluded.kilde = 'kontor' or s.kilde <> 'kontor' then coalesce(excluded.lon, s.lon) else s.lon end,
    kilde = case when excluded.kilde = 'kontor' or s.kilde = 'kontor' then 'kontor' else excluded.kilde end;
end $$;

-- Slå et sted op (bruges af Edge Function "pushover" før OpenStreetMap). Kontorets rettelser først.
create or replace function slaa_sted_op(tekst text, station text default null)
returns table (lat double precision, lon double precision, kilde text, type text)
language sql stable security definer set search_path = public as $$
  (select s.lat, s.lon, s.kilde, s.type from stedviden s
    where s.lat is not null and s.type = 'adresse' and s.noegle = 'adresse:' || sted_norm(tekst)
    limit 1)
  union all
  (select s.lat, s.lon, s.kilde, s.type from stedviden s
    where s.lat is not null and s.type = 'station' and station is not null and s.noegle = 'station:' || sted_norm(station)
    limit 1)
  limit 1
$$;

-- Lær af hver hændelse, når den får en placering eller rettes
create or replace function stedviden_laer() returns trigger
language plpgsql security definer set search_path = public as $$
declare st text; del text[]; vej text; byen text; nst record;
begin
  if new.lat is null or coalesce(new.adresse, '') = '' then return null; end if;
  st := btrim((regexp_match(coalesce(new.tekst, ''), 'Station:\s*([^\n·]+)'))[1]);
  -- 1) Kontoret har rettet placeringen eller adressen: husk det for både den gamle og den nye tekst
  if tg_op = 'UPDATE' and er_kontor() and (new.lat is distinct from old.lat or new.lon is distinct from old.lon or new.adresse is distinct from old.adresse) then
    perform laer_sted('adresse', new.adresse, null, new.lat, new.lon, 'kontor');
    if coalesce(old.adresse, '') <> '' and old.adresse is distinct from new.adresse then
      perform laer_sted('adresse', old.adresse, null, new.lat, new.lon, 'kontor');
    end if;
  elsif tg_op = 'INSERT' or new.lat is distinct from old.lat or new.adresse is distinct from old.adresse then
    -- 2) Fundet ved opslag
    perform laer_sted('adresse', new.adresse, null, new.lat, new.lon, case when new.cirka then 'nyhed' else 'geokod' end);
  else
    return null;
  end if;
  -- 3) Vejnavnet (første del af adressen uden husnummer), med byen (sidste del uden postnummer)
  del := regexp_split_to_array(new.adresse, '\s*,\s*');
  vej := btrim(regexp_replace(del[1], '\s+\d+[A-Za-z]?(\s.*)?$', ''));
  byen := btrim(regexp_replace(del[array_length(del, 1)], '^\d{4}\s+', ''));
  if array_length(del, 1) >= 2 and vej ~ '^[A-ZÆØÅ][a-zæøåé]+(\s[A-ZÆØÅa-zæøå][a-zæøåé]+){0,2}$' and vej !~* 'motorvej|^station|kommune' and (st is null or vej <> st) then
    perform laer_sted('vej', vej, case when array_length(del, 1) >= 3 then btrim(del[2]) else byen end, new.lat, new.lon, case when er_kontor() then 'kontor' else 'geokod' end);
  end if;
  -- 4) Stationen: den nærmeste brandstation (OpenStreetMap) inden for 12 km, første gang vi ser den
  if st is not null and not exists (select 1 from stedviden where noegle = 'station:' || sted_norm(st)) then
    select s.lat, s.lon, s.n into nst from stationer s where s.t = 'brand'
      order by (coalesce(s.n, '') ilike '%' || split_part(regexp_replace(st, '^(St\.|Station)\s+', '', 'i'), ' ', 1) || '%'
                and km_mellem(new.lat, new.lon, s.lat, s.lon) < 12) desc,
               km_mellem(new.lat, new.lon, s.lat, s.lon) limit 1;
    if nst.lat is not null and km_mellem(new.lat, new.lon, nst.lat, nst.lon) < 12 then
      perform laer_sted('station', st, null, nst.lat, nst.lon, 'osm');
    end if;
  end if;
  return null;
end $$;
drop trigger if exists stedviden_laer on haendelser;
create trigger stedviden_laer after insert or update of lat, lon, adresse on haendelser for each row execute function stedviden_laer();
revoke execute on function laer_sted(text, text, text, double precision, double precision, text), stedviden_laer(), slaa_sted_op(text, text) from public, anon, authenticated;

-- Start: lær af de hændelser, der allerede er placeret
do $$ declare h record; st text; nst record; del text[]; vej text; byen text; begin
  for h in select * from haendelser where lat is not null and coalesce(adresse, '') <> '' and status <> 'annulleret' order by oprettet loop
    perform laer_sted('adresse', h.adresse, null, h.lat, h.lon, case when h.cirka then 'nyhed' else 'geokod' end);
    del := regexp_split_to_array(h.adresse, '\s*,\s*');
    vej := btrim(regexp_replace(del[1], '\s+\d+[A-Za-z]?(\s.*)?$', ''));
    byen := btrim(regexp_replace(del[array_length(del, 1)], '^\d{4}\s+', ''));
    st := btrim((regexp_match(coalesce(h.tekst, ''), 'Station:\s*([^\n·]+)'))[1]);
    if array_length(del, 1) >= 2 and vej ~ '^[A-ZÆØÅ][a-zæøåé]+(\s[A-ZÆØÅa-zæøå][a-zæøåé]+){0,2}$' and vej !~* 'motorvej|^station|kommune' and (st is null or vej <> st) then
      perform laer_sted('vej', vej, case when array_length(del, 1) >= 3 then btrim(del[2]) else byen end, h.lat, h.lon, 'geokod');
    end if;
    if st is not null and not exists (select 1 from stedviden where noegle = 'station:' || sted_norm(st)) then
      select s.lat, s.lon into nst from stationer s where s.t = 'brand'
        order by (coalesce(s.n, '') ilike '%' || split_part(regexp_replace(st, '^(St\.|Station)\s+', '', 'i'), ' ', 1) || '%'
                  and km_mellem(h.lat, h.lon, s.lat, s.lon) < 12) desc,
                 km_mellem(h.lat, h.lon, s.lat, s.lon) limit 1;
      if nst.lat is not null and km_mellem(h.lat, h.lon, nst.lat, nst.lon) < 12 then perform laer_sted('station', st, null, nst.lat, nst.lon, 'osm'); end if;
    end if;
  end loop;
end $$;
