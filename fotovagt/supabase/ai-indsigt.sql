-- Fotovagt-assistenten: lærer af alle tidligere hændelser og af kontorets beslutninger.
-- For en hændelse finder den lignende hændelser (samme type, fx "bygn.brand-villa/rækkehus" eller "aba"),
-- og regner ud:
--   * hvilke enheder der plejer at blive sendt (typer og konkrete enheder ved samme station/postnummer)
--   * hvor ofte den slags blev høj prioritet, eskaleret eller opgraderet – og om kontoret afviste det
--   * hvor ofte en fotograf kørte, og hvor længe de plejer at vare
--   * et forslag til prioritet og alvor med begrundelse
-- Jo flere hændelser og beslutninger, jo bedre forslag. Intet sendes ud af databasen.
-- Kør i Supabase -> SQL Editor.

-- Typen af en hændelse ud fra titlen: "Bygn.brand-Villa/Rækkehus – bygningsbrand" -> "bygn.brand-villa/rækkehus"
create or replace function type_noegle(titel text) returns text
language sql immutable set search_path = public as $$
  select case
    when t ~ '^(aba|automatisk brandalarm)' then 'aba'
    when lower(coalesce(titel, '')) ~ '\m[a-zæøå]+\.?brand-[a-zæøå/]+' then (regexp_match(lower(titel), '\m([a-zæøå]+\.?brand-[a-zæøå/]+)'))[1]
    when t ~ '^(ass\.?|assistance)\M' then 'assistance'
    else nullif(split_part(t, ' ', 1), '') end
  from (select btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(titel, '')),
      '\s[–—]\s.*$', ''),                                   -- " – bygningsbrand" (Fotovagts tilføjelse)
      '\([^)]*\)|#\d+|@\d+|[^[:alpha:][:space:]./-]', ' ', 'g'), -- parenteser, sagsnumre, tal og emoji
      '\m(isl|oc|[a-zæøå]{2,3}[ -]?(mr|[mvsrbtkh]))\M', ' ', 'g'), -- enhedskoder
      '^[\s.-]+', ''),
      '^\S{1,5}\s+-\s+', '')) as t) x                         -- stationsforkortelse: "BBLe - Bygn.brand-…"
$$;

-- Enhederne i en tekst, uden gentagelser: {SY-M1, SY-V1, ISL NO, OC}
create or replace function enheder_liste(t text) returns text[]
language sql immutable set search_path = public as $$
  select coalesce(array_agg(distinct k order by k), '{}') from (
    select case when m[1] ~ '^(ISL|OC)' then regexp_replace(m[1], '\s+', ' ', 'g')
                else regexp_replace(m[1], '^([A-ZÆØÅ]{2,3})[\s-]?(MR|[MVSRBTKH])[\s-]?(\d{1,2})$', '\1-\2\3') end as k
      from regexp_matches(coalesce(t, ''), '\m([A-ZÆØÅ]{2,3}[\s-]?(?:MR|[MVSRBTKH])[\s-]?\d{1,2}|ISL\s+[A-ZÆØÅ]{2,3}|OC)\M', 'g') m) x
$$;

-- Enhedstype: SY-M1 -> M, ISL NO -> ISL
create or replace function enhed_type(k text) returns text
language sql immutable as $$
  select case when k ~ '^ISL' then 'ISL' when k = 'OC' then 'OC' else regexp_replace(k, '^[A-ZÆØÅ]+-([A-Z]+)\d+$', '\1') end
$$;

-- Grundalvor ud fra titlen (samme skala som opgraderingen i parse.js): 3 stor, 2 normal, 1 lille
create or replace function grund_alvor(titel text) returns int
language sql immutable as $$
  select case
    when titel ~* '(bygn\.?\s?brand|bygningsbrand|naturbrand|skibsbrand|brand i |brand-(?!alarm)|eksplosion|redn\.|drukn|person i vand|fastklemt|omkommet|dræbt|dødsulykke|dødelig|frontal|hjertestop|skud|knivstik|bevæbnet)' then 3
    when titel ~* '(eftersyn|\maba\d*\M|automatisk brandalarm|forespørgsel|\mass\.|assistance|advarsel|havareret|tabt gods|dyr på vejen|kør forsigtigt|vejarbejde|(^|\s)kø($|\s)|planlagt|cyklister på vejen|personer på vejen)' then 1
    when titel ~* '(uheld|ulykke|brand|\mild\M|røg|redning|politi|anholdt|efterlys)' then 2
    else 2 end
$$;

-- Hvor hændelsen er fra: "Station: Viby" eller postnummeret
create or replace function sted_noegle(h haendelser) returns text
language sql immutable as $$
  select coalesce(btrim(lower((regexp_match(coalesce(h.tekst, ''), 'Station:\s*([^\n·]+)'))[1])), (regexp_match(coalesce(h.adresse, '') || ' ' || coalesce(h.tekst, ''), '\m(\d{4})\M'))[1])
$$;

create or replace function ai_indsigt(h uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  hh haendelser; fuld text; grov text; niveau text; ids uuid[]; n int; n_enh int; sted text;
  typer jsonb; konkrete jsonb; median_enh numeric; n_hoej int; n_afvist int; n_foto int; varighed numeric;
  forslag int := 2; grund text[] := '{}'; alvor text; n_beslut int; ga int;
begin
  if not er_bruger() then raise exception 'Ikke adgang'; end if;
  select * into hh from haendelser where id = h;
  if hh.id is null then return null; end if;
  fuld := type_noegle(hh.titel);
  grov := split_part(fuld, '-', 1);
  sted := sted_noegle(hh);

  -- 1. Samme type, 2. samme hovedtype (før "-"), 3. samme kategori
  select array_agg(id) into ids from (select id from haendelser x where x.id <> h and x.oprettet > now() - interval '2 years'
    and type_noegle(x.titel) = fuld order by oprettet desc limit 500) a;
  niveau := 'samme type';
  if coalesce(array_length(ids, 1), 0) < 3 and grov <> fuld then
    select array_agg(id) into ids from (select id from haendelser x where x.id <> h and x.oprettet > now() - interval '2 years'
      and split_part(type_noegle(x.titel), '-', 1) = grov order by oprettet desc limit 500) a;
    niveau := 'samme hovedtype';
  end if;
  if coalesce(array_length(ids, 1), 0) < 3 then
    select array_agg(id) into ids from (select id from haendelser x where x.id <> h and x.oprettet > now() - interval '2 years'
      and x.kategori is not distinct from hh.kategori order by oprettet desc limit 500) a;
    niveau := 'samme kategori';
  end if;
  n := coalesce(array_length(ids, 1), 0);
  if n = 0 then return jsonb_build_object('n', 0, 'type', fuld); end if;

  -- Enheder
  with l as (select x.id, sted_noegle(x) as st, enheder_liste(coalesce(x.titel, '') || ' ' || coalesce(x.tekst, '')) as e from haendelser x where x.id = any(ids)),
       me as (select * from l where cardinality(e) > 0)
  select (select count(*) from me),
         (select percentile_cont(0.5) within group (order by cardinality(e)) from me),
         (select coalesce(jsonb_agg(jsonb_build_object('type', t, 'andel', round(c::numeric / nullif((select count(*) from me), 0), 2)) order by c desc), '[]')
            from (select t, count(distinct id) c from me, unnest(e) u, enhed_type(u) t group by t order by c desc limit 6) a),
         (select coalesce(jsonb_agg(jsonb_build_object('enhed', u, 'gange', c) order by c desc), '[]')
            from (select u, count(*) c from me, unnest(e) u where sted is not null and me.st = sted group by u order by c desc limit 6) b)
    into n_enh, median_enh, typer, konkrete;

  -- Kontorets beslutninger og forløb
  select count(*) filter (where x.prio = 1 or x.eskaleret or x.opgraderet is not null),
         count(*) filter (where x.prio_tid is not null or x.eskaleret or x.eskalering_afvist or x.taget_af is not null),
         count(*) filter (where x.eskalering_afvist),
         count(*) filter (where x.taget_af is not null),
         percentile_cont(0.5) within group (order by extract(epoch from (coalesce(x.afsluttet_tid, x.sidst_aktiv) - x.oprettet)) / 60)
           filter (where x.status not in ('ny', 'taget', 'ankommet'))
    into n_hoej, n_beslut, n_afvist, n_foto, varighed
    from haendelser x where x.id = any(ids);

  -- Forslag: lærer af hvor ofte kontoret gjorde den slags til høj prioritet (og af afviste eskaleringer)
  ga := grund_alvor(hh.titel);
  if n_beslut < 3 then
    -- For få beslutninger at lære af endnu: start ud fra hændelsestypen
    forslag := case ga when 3 then 1 when 1 then 3 else 2 end;
    grund := grund || format('ud fra typen – lærer stadig (%s beslutninger på lignende hændelser)', n_beslut);
  elsif n_hoej >= 2 and n_hoej::numeric / n >= 0.35 then
    forslag := 1; grund := grund || format('%s af %s lignende blev høj prioritet/opgraderet', n_hoej, n);
  elsif n_hoej = 0 and n_foto::numeric / n < 0.1 and ga < 3 then
    forslag := 3; grund := grund || format('ingen af %s lignende blev prioriteret højt, og fotograf kørte sjældent', n);
  else
    forslag := case when ga = 3 then 1 else 2 end;
    grund := grund || format('%s af %s lignende blev høj prioritet', n_hoej, n);
  end if;
  if n_afvist > 0 then grund := grund || format('kontoret afviste eskalering %s gang(e)', n_afvist); end if;
  if n_enh >= 3 and coalesce(hh.antal_enheder, 0) > median_enh + 1 then
    forslag := least(forslag, 1); grund := grund || format('flere enheder end normalt (%s mod typisk %s)', hh.antal_enheder, round(median_enh));
  end if;
  alvor := case when forslag = 1 then 'stor' when forslag = 3 then 'lille' else 'normal' end;

  return jsonb_build_object(
    'n', n, 'niveau', niveau, 'type', fuld, 'sted', sted,
    'n_med_enheder', n_enh, 'typisk_antal', round(median_enh), 'enhedstyper', typer, 'enheder_her', konkrete,
    'andel_hoej', round(n_hoej::numeric / n, 2), 'afvist', n_afvist, 'andel_foto', round(n_foto::numeric / n, 2),
    'varighed_min', round(varighed), 'beslutninger', n_beslut, 'forslag_prio', forslag, 'alvor', alvor, 'grund', array_to_json(grund));
end $$;
revoke execute on function ai_indsigt(uuid) from public, anon;
grant execute on function ai_indsigt(uuid) to authenticated;
