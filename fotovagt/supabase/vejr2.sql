-- Fotovagt 15.30: vejret fra flere kilder.
--  1. met.no (Norges meteorologiske institut): prognose for stedet (vejrtype, nedbør, vind, temperatur, tåge)
--  2. DMI (åbne data, opendataapi.dmi.dk): målt vind, vindstød, retning, temperatur og fugt fra nærmeste station
--  3. DMI-farevarsler via MeteoAlarm (feeds.meteoalarm.org) – tabellen vejrvarsler
-- haendelser.vejr = { prognose: {...}, obs: {...}, + samlede felter (måling vinder over prognose for vind/temp/fugt) }

-- Samlede felter: målt (DMI, højst 30 km og 90 min gammel) vinder over prognosen
create or replace function vejr_flet(p jsonb, o jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_strip_nulls(coalesce(p, '{}') - 'kilde'
    || case when o is not null and coalesce((o->>'km')::numeric, 99) <= 30 then jsonb_strip_nulls(jsonb_build_object(
         'vind', o->'vind', 'stoed', o->'stoed', 'retning', o->'retning', 'temp', o->'temp', 'fugt', o->'fugt')) else '{}' end
    || jsonb_build_object(
      'prognose', p, 'obs', o,
      'kilder', to_jsonb(array_remove(array[case when p is not null then 'met.no' end, case when o is not null then 'DMI' end], null))))
$$;

-- met.no-svaret gemmes nu som "prognose" og flettes med en evt. DMI-måling
do $do$ declare def text; begin
  def := pg_get_functiondef('public.vejr_saml()'::regprocedure);
  if position('vejr_flet' in def) = 0 then
    def := replace(def, $a$update haendelser set vejr = jsonb_strip_nulls(jsonb_build_object($a$,
                        $a$update haendelser set vejr = vejr_flet(jsonb_strip_nulls(jsonb_build_object($a$);
    def := replace(def, $a$'kilde', 'met.no'))
         where id = k.haendelse_id;$a$, $a$'kilde', 'met.no')), vejr->'obs')
         where id = k.haendelse_id;$a$);
    execute def;
  end if;
  -- met.no hentes også, når DMI-målingen kom først
  def := pg_get_functiondef('public.vejr_bestil()'::regprocedure);
  if position('prognose' in def) = 0 then
    def := replace(def, $a$x.vejr is null and x.oprettet$a$, $a$(x.vejr is null or (x.vejr->'prognose' is null and x.vejr->'symbol' is null)) and x.oprettet$a$);
    execute def;
  end if;
end $do$;

-- DMI-målinger: én forespørgsel pr. hændelse (alle stationer inden for ca. 30 km, seneste time)
create table if not exists vejr_obs_koe (
  haendelse_id uuid primary key references haendelser(id) on delete cascade,
  req_id bigint, sendt timestamptz not null default now(), forsoeg int not null default 1
);
alter table vejr_obs_koe enable row level security;

create or replace function vejr_obs_bestil() returns int
language plpgsql security definer set search_path = public as $$
declare h record; n int := 0;
begin
  delete from vejr_obs_koe where sendt < now() - interval '3 hours';
  for h in
    select x.id, x.lat, x.lon, k.forsoeg from haendelser x left join vejr_obs_koe k on k.haendelse_id = x.id
     where x.lat is not null and (x.vejr is null or x.vejr->'obs' is null) and x.oprettet > now() - interval '2 hours'
       and (k.haendelse_id is null or (k.sendt < now() - interval '5 minutes' and k.forsoeg < 3))
     order by x.oprettet desc limit 10
  loop
    insert into vejr_obs_koe (haendelse_id, req_id, forsoeg)
    values (h.id, net.http_get(
        format('https://opendataapi.dmi.dk/v2/metObs/collections/observation/items?bbox=%s,%s,%s,%s&period=latest-hour&limit=2000',
          round((h.lon - 0.45)::numeric, 3), round((h.lat - 0.27)::numeric, 3), round((h.lon + 0.45)::numeric, 3), round((h.lat + 0.27)::numeric, 3)),
        timeout_milliseconds := 15000), coalesce(h.forsoeg, 0) + 1)
    on conflict (haendelse_id) do update set req_id = excluded.req_id, sendt = now(), forsoeg = vejr_obs_koe.forsoeg + 1;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function vejr_obs_saml() returns int
language plpgsql security definer set search_path = public as $$
declare k record; o jsonb; n int := 0;
begin
  for k in select q.haendelse_id, r.status_code, r.content, x.lat, x.lon
             from vejr_obs_koe q join net._http_response r on r.id = q.req_id join haendelser x on x.id = q.haendelse_id loop
    if k.status_code = 200 then
      begin
        with m as (
          select f->'properties'->>'parameterId' p, (f->'properties'->>'value')::numeric v, f->'properties'->>'stationId' st,
                 (f->'properties'->>'observed')::timestamptz t,
                 sqrt(power(((f->'geometry'->'coordinates'->>1)::numeric - k.lat) * 111, 2)
                    + power(((f->'geometry'->'coordinates'->>0)::numeric - k.lon) * 111 * cos(radians(k.lat)), 2))::numeric km
            from jsonb_array_elements(k.content::jsonb->'features') f
           where f->'properties'->>'parameterId' in ('wind_speed', 'wind_max', 'wind_gust_always_past1h', 'wind_dir', 'temp_dry', 'humidity', 'precip_past1h', 'visibility')
        ), bedst as (
          -- nærmeste station med målingen, seneste værdi
          select distinct on (p) p, v, st, t, km from m order by p, km, t desc
        )
        select jsonb_strip_nulls(jsonb_build_object(
          'station', (select st from bedst where p = 'wind_speed'),
          'km', (select round(km, 1) from bedst where p = 'wind_speed'),
          'tid', (select t from bedst where p = 'wind_speed'),
          'vind', (select round(v, 1) from bedst where p = 'wind_speed'),
          'stoed', (select round(v, 1) from bedst where p = coalesce((select p from bedst where p = 'wind_gust_always_past1h'), 'wind_max')),
          'retning', (select round(v) from bedst where p = 'wind_dir'),
          'temp', (select round(v, 1) from bedst where p = 'temp_dry'),
          'fugt', (select round(v) from bedst where p = 'humidity'),
          'nedboer_1t', (select round(v, 1) from bedst where p = 'precip_past1h'),
          'sigt_m', (select round(v) from bedst where p = 'visibility'),
          'kilde', 'DMI')) into o;
        if o ? 'vind' or o ? 'temp' then
          update haendelser set vejr = vejr_flet(coalesce(vejr->'prognose', nullif(coalesce(vejr, '{}') - 'obs' - 'kilder' - 'prognose', '{}'::jsonb)), o) where id = k.haendelse_id;
          n := n + 1;
          delete from vejr_obs_koe where haendelse_id = k.haendelse_id;
        else
          update vejr_obs_koe set req_id = null, forsoeg = 3 where haendelse_id = k.haendelse_id;   -- ingen station i nærheden: prøv ikke igen
        end if;
      exception when others then
        update vejr_obs_koe set req_id = null, forsoeg = forsoeg + 1 where haendelse_id = k.haendelse_id;
      end;
    elsif k.status_code is not null then
      update vejr_obs_koe set sendt = now() - interval '4 minutes' where haendelse_id = k.haendelse_id;
    end if;
  end loop;
  return n;
end $$;

-- DMI-farevarsler (MeteoAlarm, CAP). Aktive varsler for Danmark, hentes hvert 15. minut.
create table if not exists vejrvarsler (
  id text primary key, haendelse text, niveau text, omraade text, beskrivelse text,
  fra timestamptz, til timestamptz, hentet timestamptz not null default now()
);
alter table vejrvarsler enable row level security;
drop policy if exists varsler_laes on vejrvarsler;
create policy varsler_laes on vejrvarsler for select to authenticated using (er_bruger());
create table if not exists varsel_koe (id int primary key default 1, req_id bigint, sendt timestamptz, fejl text);
alter table varsel_koe enable row level security;

create or replace function varsler_hent() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into varsel_koe (id, req_id, sendt)
  values (1, net.http_get('https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-denmark', timeout_milliseconds := 20000), now())
  on conflict (id) do update set req_id = excluded.req_id, sendt = now();
end $$;

create or replace function varsler_saml() returns int
language plpgsql security definer set search_path = public as $$
declare r record; e xml; ns text[][] := array[array['a', 'http://www.w3.org/2005/Atom'], array['cap', 'urn:oasis:names:tc:emergency:cap:1.2']];
  n int := 0; ids text[] := '{}'; vid text;
begin
  select q.req_id, s.status_code, s.content into r from varsel_koe q join net._http_response s on s.id = q.req_id where q.id = 1;
  if r.req_id is null then return 0; end if;
  if r.status_code is distinct from 200 then update varsel_koe set req_id = null, fejl = 'HTTP ' || coalesce(r.status_code::text, '?') where id = 1; return 0; end if;
  begin
    foreach e in array xpath('/a:feed/a:entry', r.content::xml, ns) loop
      vid := (xpath('/a:entry/a:id/text()', e, ns))[1]::text;
      continue when vid is null;
      ids := ids || vid;
      insert into vejrvarsler (id, haendelse, niveau, omraade, beskrivelse, fra, til, hentet)
      values (vid,
        (xpath('/a:entry/cap:event/text()', e, ns))[1]::text,
        (xpath('/a:entry/cap:severity/text()', e, ns))[1]::text,
        (xpath('/a:entry/cap:areaDesc/text()', e, ns))[1]::text,
        rens_xml_tekst((xpath('/a:entry/a:title/text()', e, ns))[1]::text),
        nullif((xpath('/a:entry/cap:onset/text()', e, ns))[1]::text, '')::timestamptz,
        nullif((xpath('/a:entry/cap:expires/text()', e, ns))[1]::text, '')::timestamptz, now())
      on conflict (id) do update set haendelse = excluded.haendelse, niveau = excluded.niveau, omraade = excluded.omraade,
        beskrivelse = excluded.beskrivelse, fra = excluded.fra, til = excluded.til, hentet = now();
      n := n + 1;
    end loop;
    delete from vejrvarsler where not (id = any(ids)) or til < now();
    update varsel_koe set req_id = null, fejl = null where id = 1;
  exception when others then
    update varsel_koe set req_id = null, fejl = left(sqlerrm, 200) where id = 1;
  end;
  return n;
end $$;

revoke execute on function vejr_obs_bestil(), vejr_obs_saml(), varsler_hent(), varsler_saml() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname in ('fotovagt-vejr-obs', 'fotovagt-varsler-hent', 'fotovagt-varsler-saml');
select cron.schedule('fotovagt-vejr-obs', '* * * * *', $$select vejr_obs_saml(); select vejr_obs_bestil();$$);
select cron.schedule('fotovagt-varsler-hent', '*/15 * * * *', $$select varsler_hent();$$);
select cron.schedule('fotovagt-varsler-saml', '* * * * *', $$select varsler_saml();$$);
