-- Fotovagt 15.01: vejret på stedet for hver hændelse (met.no Locationforecast, gratis og må bruges
-- kommercielt med kildeangivelse). Hentes af databasen med pg_net hvert minut for nye hændelser med placering.
-- Assistenten (ai_indsigt) sammenholder vejret med hændelsen og giver en fareadvarsel / højere eller lavere prioritet.
alter table haendelser add column if not exists vejr jsonb;

create table if not exists vejr_koe (
  haendelse_id uuid primary key references haendelser(id) on delete cascade,
  req_id bigint not null,
  sendt timestamptz not null default now(),
  forsoeg int not null default 1
);
alter table vejr_koe enable row level security;   -- kun databasen selv bruger køen

-- met.no-symbol → dansk tekst
create or replace function vejr_tekst(sym text) returns text
language sql immutable set search_path = public as $$
  select case
    when sym is null then null
    when sym ~ 'thunder' then 'Torden'
    when sym ~ 'heavysleet' then 'Kraftig slud' when sym ~ 'sleet' then 'Slud'
    when sym ~ 'heavysnow' then 'Kraftigt snevejr' when sym ~ 'snow' then 'Sne'
    when sym ~ 'heavyrain' then 'Kraftig regn' when sym ~ 'lightrain' then 'Let regn' when sym ~ 'rain' then 'Regn'
    when sym ~ '^fog' then 'Tåge'
    when sym ~ '^clearsky' then 'Klart' when sym ~ '^fair' then 'Let skyet'
    when sym ~ '^partlycloudy' then 'Delvis skyet' when sym ~ '^cloudy' then 'Overskyet'
    else sym end
$$;

-- Bestil vejr for nye hændelser (højst 10 pr. minut). Placering rundes til 2 decimaler (ca. 1 km) som met.no ønsker.
create or replace function vejr_bestil() returns int
language plpgsql security definer set search_path = public as $$
declare h record; n int := 0;
begin
  -- Svar, der aldrig kom, prøves igen efter 5 minutter (højst 3 gange)
  delete from vejr_koe where sendt < now() - interval '5 minutes' and forsoeg >= 3;
  for h in
    select x.id, x.lat, x.lon, k.forsoeg from haendelser x left join vejr_koe k on k.haendelse_id = x.id
     where x.lat is not null and x.vejr is null and x.oprettet > now() - interval '12 hours'
       and (k.haendelse_id is null or k.sendt < now() - interval '5 minutes')
     order by x.oprettet desc limit 10
  loop
    insert into vejr_koe (haendelse_id, req_id, forsoeg)
    values (h.id, net.http_get(
        format('https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=%s&lon=%s', round(h.lat::numeric, 2), round(h.lon::numeric, 2)),
        headers := '{"User-Agent":"Fotovagt/15 https://vagt.hrc-fotos.dk"}'::jsonb, timeout_milliseconds := 10000),
      coalesce(h.forsoeg, 0) + 1)
    on conflict (haendelse_id) do update set req_id = excluded.req_id, sendt = now(), forsoeg = vejr_koe.forsoeg + 1;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Saml svarene: tag tidspunktet nærmest hændelsens oprettelse
create or replace function vejr_saml() returns int
language plpgsql security definer set search_path = public as $$
declare k record; j jsonb; t jsonb; d jsonb; n int := 0;
begin
  for k in
    select q.haendelse_id, r.status_code, r.content, x.oprettet
      from vejr_koe q join net._http_response r on r.id = q.req_id join haendelser x on x.id = q.haendelse_id
  loop
    if k.status_code = 200 then
      begin
        j := k.content::jsonb;
        select e into t from jsonb_array_elements(j->'properties'->'timeseries') e
         order by abs(extract(epoch from (e->>'time')::timestamptz - k.oprettet)) limit 1;
        d := t->'data'->'instant'->'details';
        update haendelser set vejr = jsonb_strip_nulls(jsonb_build_object(
            'tid', t->>'time',
            'temp', round((d->>'air_temperature')::numeric, 1),
            'vind', round((d->>'wind_speed')::numeric, 1),
            'stoed', round((d->>'wind_speed_of_gust')::numeric, 1),
            'retning', round((d->>'wind_from_direction')::numeric),
            'fugt', round((d->>'relative_humidity')::numeric),
            'taage', round((d->>'fog_area_fraction')::numeric),
            'nedboer', round(coalesce((t->'data'->'next_1_hours'->'details'->>'precipitation_amount')::numeric, 0), 1),
            'symbol', t->'data'->'next_1_hours'->'summary'->>'symbol_code',
            'tekst', vejr_tekst(t->'data'->'next_1_hours'->'summary'->>'symbol_code'),
            'kilde', 'met.no'))
         where id = k.haendelse_id;
        n := n + 1;
      exception when others then null;   -- ugyldigt svar: prøves igen
      end;
      delete from vejr_koe where haendelse_id = k.haendelse_id;
    elsif k.status_code is not null and k.status_code not in (200) then
      update vejr_koe set sendt = now() - interval '4 minutes' where haendelse_id = k.haendelse_id;   -- prøv igen om ca. 1 min
    end if;
  end loop;
  return n;
end $$;

revoke execute on function vejr_bestil(), vejr_saml() from public, anon, authenticated;

-- Hvert minut: saml svar og bestil nye
select cron.unschedule('fotovagt-vejr') where exists (select 1 from cron.job where jobname = 'fotovagt-vejr');
select cron.schedule('fotovagt-vejr', '* * * * *', $$select vejr_saml(); select vejr_bestil();$$);

-- Vejr og hændelse: fareadvarsel og retning for prioriteten (+1 = højere, -1 = lavere, 0 = ingen ændring)
create or replace function vejr_vurdering(h haendelser) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v jsonb := h.vejr; t text := lower(coalesce(h.titel, '') || ' ' || coalesce(h.kategori, '') || ' ' || split_part(coalesce(h.tekst, ''), E'\n', 1));
  temp numeric; vind numeric; stoed numeric; regn numeric; taage numeric; sym text;
  fare text[] := '{}'; retning int := 0;
  brand boolean; trafik boolean; vand boolean; natur boolean; vejrsag boolean;
begin
  if v is null then return null; end if;
  temp := (v->>'temp')::numeric; vind := coalesce((v->>'vind')::numeric, 0); stoed := coalesce((v->>'stoed')::numeric, vind);
  regn := coalesce((v->>'nedboer')::numeric, 0); taage := coalesce((v->>'taage')::numeric, 0); sym := coalesce(v->>'symbol', '');
  brand := t ~ 'brand|røg|ild' and t !~ 'brandalarm|\maba\M|eftersyn';
  natur := t ~ 'naturbrand|markbrand|skovbrand|halmbrand|krat|hede|græs';
  trafik := t ~ 'trafik|uheld|færdsel|motorvej|kørt|bil|lastbil|frontal|rute \d|glat';
  vand := t ~ 'drukn|person i vand|(?<!luft)havn|kæntr|skib|båd|redning til søs|strand';
  vejrsag := t ~ 'storm|træ.*vej|væltet træ|tag.*blæst|oversvøm|vand i kælder|skybrud';

  if stoed >= 24.5 then fare := fare || format('Stormvejr (vindstød %s m/s) – risiko for væltede træer, løse tagplader og flere hændelser', stoed); retning := 1;
  elsif stoed >= 20.8 and vejrsag then fare := fare || format('Kraftig vind (stød %s m/s) forværrer skaderne', stoed); retning := 1;
  end if;
  if brand and stoed >= 13.9 then
    fare := fare || format('Hård vind (stød %s m/s fra %s) kan sprede branden og røgen', stoed, vindretning(v->>'retning')); retning := 1;
  elsif natur and vind >= 8 and regn = 0 and coalesce((v->>'fugt')::numeric, 100) < 60 then
    fare := fare || format('Tørt og blæsende (%s m/s, %s%% luftfugtighed) – naturbranden kan sprede sig hurtigt', vind, v->>'fugt'); retning := 1;
  elsif natur and regn >= 1 then
    fare := fare || format('Regn (%s mm/t) dæmper spredning af naturbranden', regn); retning := least(retning, 0) - 1;
  end if;
  if trafik and temp is not null and temp <= 1 and (regn > 0 or sym ~ 'sleet|snow|rain') then
    fare := fare || format('Glat føre: %s °C med nedbør – risiko for isslag og flere uheld', temp); retning := 1;
  elsif trafik and temp is not null and temp <= 0 then
    fare := fare || format('Frost (%s °C) – mulig rimfrost og glatte veje', temp);
  end if;
  if trafik and (taage >= 50 or sym ~ '^fog') then fare := fare || 'Tåge – nedsat sigtbarhed, risiko for kædekollision'; retning := 1; end if;
  if trafik and sym ~ 'heavysnow' then fare := fare || 'Kraftigt snevejr – vanskelig fremkommelighed'; retning := 1; end if;
  if vand and (vind >= 10.8 or (temp is not null and temp < 8)) then
    fare := fare || format('%s – kort tid i vandet før nedkøling', concat_ws(', ', case when vind >= 10.8 then format('Hård vind (%s m/s) og bølger', vind) end, case when temp < 8 then format('koldt (%s °C)', temp) end)); retning := 1;
  end if;
  if vejrsag and regn >= 10 then fare := fare || format('Skybrud (%s mm/t)', regn); retning := 1; end if;
  if sym ~ 'thunder' and (brand or vejrsag) then fare := fare || 'Torden i området'; end if;

  return jsonb_build_object('advarsler', to_jsonb(fare), 'retning', greatest(-1, least(1, retning)));
end $$;

create or replace function vindretning(grader text) returns text
language sql immutable set search_path = public as $$
  select case when grader is null then '?' else
    (array['nord','nordøst','øst','sydøst','syd','sydvest','vest','nordvest'])[((round(grader::numeric / 45)::int % 8) + 1)] end
$$;

-- Assistenten: vejret flytter forslaget én tak (højere ved fare, lavere når vejret dæmper), og forklarer hvorfor
do $do$
declare def text;
begin
  def := pg_get_functiondef('public.ai_indsigt'::regproc);
  if position('vejr_vurdering' in def) = 0 then
    def := replace(def, $a$  alvor := case when forslag = 1 then 'stor'$a$,
$a$  -- Vejret på stedet (vejr.sql)
  if hh.vejr is not null then
    declare vv jsonb := vejr_vurdering(hh);
    begin
      if (vv->>'retning')::int = 1 and forslag > 1 then forslag := forslag - 1; grund := grund || ('vejret: ' || (vv->'advarsler'->>0))::text;
      elsif (vv->>'retning')::int = -1 and forslag < 3 then forslag := forslag + 1; grund := grund || ('vejret: ' || (vv->'advarsler'->>0))::text;
      end if;
    end;
  end if;
  alvor := case when forslag = 1 then 'stor'$a$);
    def := replace(def, $a$'grund', array_to_json(grund));$a$,
      $a$'grund', array_to_json(grund), 'vejr', hh.vejr, 'vejr_fare', vejr_vurdering(hh));$a$);
    def := replace(def, $a$return jsonb_build_object('n', 0, 'type', fuld);$a$,
      $a$return jsonb_build_object('n', 0, 'type', fuld, 'vejr', hh.vejr, 'vejr_fare', vejr_vurdering(hh));$a$);
    execute def;
  end if;
end $do$;

-- Døgnrapporten (15.01): vejret ved alarmen og nyhedslinks pr. hændelse. Erstatter versionen i kommentarer-doegnrapport.sql.
CREATE OR REPLACE FUNCTION public.doegnrapport(dag date DEFAULT NULL::date)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with d as (select coalesce(dag, (now() at time zone 'Europe/Copenhagen')::date) as dag)
  select jsonb_build_object(
    'dag', (select dag from d),
    'opdateret', now(),
    'haendelser', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', left(md5(h.id::text), 12),
        'tid', h.oprettet,
        'kategori', coalesce(h.kategori, 'Andet'),
        'ikon', case when h.titel ~* 'helikopter' then 'helikopter'
                     when h.titel ~* '^\s*(ISL\M|indsatsleder)' then 'isl' end,
        'overskrift', coalesce(nullif(trim(h.offentlig_titel), ''),
          case coalesce(h.kategori, 'Andet') when 'Andet' then 'Hændelse' else h.kategori end),
        'sted', coalesce(h.omraade, offentlig_adresse(h.adresse)),
        'lat', round(h.lat::numeric, 2),
        'lon', round(h.lon::numeric, 2),
        'status', case when h.status in ('afsluttet') then 'afsluttet' else 'aktiv' end,
        'paa_stedet', h.status = 'ankommet' or (h.status = 'afsluttet' and h.ankommet_tid is not null),
        'vejr', case when h.vejr is not null then jsonb_strip_nulls(jsonb_build_object(
            'tekst', h.vejr->>'tekst', 'symbol', h.vejr->>'symbol', 'temp', h.vejr->'temp', 'vind', h.vejr->'vind',
            'stoed', h.vejr->'stoed', 'retning', vindretning(h.vejr->>'retning'), 'nedboer', h.vejr->'nedboer')) end,
        -- Nyhedslinks (ikke ved efterlysninger: politiet beder ofte om at fjerne navn og billede bagefter)
        'nyheder', case when h.titel ~* 'efterlys|savnet|forsvundet' then '[]'::jsonb else coalesce((
          select jsonb_agg(jsonb_build_object('url', n->>'url',
                   'kilde', regexp_replace(substring(n->>'url' from '^https?://([^/]+)'), '^(www|via)\.', '')) order by n->>'tid')
            from jsonb_array_elements(h.nyheder) n where er_nyhedslink(n->>'url')), '[]'::jsonb) end,
        'kommentarer', coalesce((
          select jsonb_agg(jsonb_build_object('tid', k.oprettet, 'tekst', k.tekst) order by k.oprettet)
            from kommentarer k where k.haendelse_id = h.id and k.offentlig), '[]'::jsonb)
      ) order by h.oprettet desc)
      from haendelser h, d
      where (h.oprettet at time zone 'Europe/Copenhagen')::date = d.dag
        and h.offentlig and h.status <> 'annulleret'
    ), '[]'::jsonb));
$function$;
