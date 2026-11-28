-- Brand-, politi- og ambulancestationer til kortet (filterknapperne 🚒 👮 🚑 øverst til højre).
-- Data: OpenStreetMap (© OpenStreetMap-bidragydere, ODbL), hentet via Overpass-API'et fra databasen selv.
-- Kør i Supabase -> SQL Editor. Opdatér data: kør "Genindlæs" nederst (tager et par minutter).

create table if not exists stationer (
  id text primary key,            -- OpenStreetMap-id, fx "node/123"
  t text not null check (t in ('brand', 'politi', 'ambulance')),
  n text, a text, op text,
  lat double precision not null, lon double precision not null,
  opdateret timestamptz not null default now()
);
alter table stationer enable row level security;
drop policy if exists "laes" on stationer;
create policy "laes" on stationer for select to authenticated using (er_bruger());
revoke all on table stationer from anon;

-- Indlæs fra et svar fra Overpass (net._http_response). Kun danske stationer.
create or replace function stationer_indlaes(svar bigint, type text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into stationer (id, t, n, a, op, lat, lon, opdateret)
  select e->>'type' || '/' || (e->>'id'), type,
         nullif(e->'tags'->>'name', ''),
         nullif(concat_ws(', ', nullif(concat_ws(' ', e->'tags'->>'addr:street', e->'tags'->>'addr:housenumber'), ''),
                                nullif(concat_ws(' ', e->'tags'->>'addr:postcode', e->'tags'->>'addr:city'), '')), ''),
         nullif(e->'tags'->>'operator', ''),
         coalesce((e->>'lat')::float8, (e->'center'->>'lat')::float8), coalesce((e->>'lon')::float8, (e->'center'->>'lon')::float8), now()
    from net._http_response r, jsonb_array_elements(r.content::jsonb->'elements') e
   where r.id = svar and r.status_code = 200
     and coalesce((e->>'lat')::float8, (e->'center'->>'lat')::float8) is not null
     and (coalesce(e->'tags'->>'addr:postcode', '') ~ '^\d{4}$' or coalesce(e->'tags'->>'addr:postcode', '') = '')
     and coalesce(e->'tags'->>'addr:country', 'DK') = 'DK'
     and coalesce(e->'tags'->>'name', '') !~* 'polizei|feuerwehr|räddning|polis|brandkår|ambulans|\mFFW\M'
     and coalesce(e->'tags'->>'operator', '') !~* 'polizei|feuerwehr|räddning|polis'
  on conflict (id) do update set t = excluded.t, n = excluded.n, a = excluded.a, op = excluded.op, lat = excluded.lat, lon = excluded.lon, opdateret = now();
  get diagnostics n = row_count;
  perform stationer_ryd_udland();
  return n;
end $$;
-- Fjern stationer i Sverige og Tyskland, der ligger inden for kassen omkring Danmark
create or replace function stationer_ryd_udland() returns int language sql security definer set search_path = public as $$
  with d as (delete from stationer where (lat > 55.4 and lon > 12.75) or (lat > 56.3 and lon > 11.8) or (lat < 54.8 and lon > 12.3) or (lon < 8.47 and lat < 55.06) returning 1)
  select count(*)::int from d $$;
revoke execute on function stationer_indlaes(bigint, text), stationer_ryd_udland() from public, anon, authenticated;

-- Genindlæs (kør trin 1, vent 1–2 minutter, kør trin 2 med de tre id'er fra trin 1):
-- 1) select t, net.http_get(url := 'https://overpass-api.de/api/interpreter',
--      params := jsonb_build_object('data', '[out:json][timeout:90];(' || f || '(54.55,8.0,57.8,12.7);' || f || '(54.95,14.6,55.35,15.2););out center tags;'),
--      timeout_milliseconds := 100000) as id
--    from (values ('brand','nwr["amenity"="fire_station"]'), ('politi','nwr["amenity"="police"]'), ('ambulance','nwr["emergency"="ambulance_station"]')) v(t, f);
-- 2) select stationer_indlaes(<id>, '<t>');   -- én gang for hver af de tre
