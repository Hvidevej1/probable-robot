-- Fotovagt 15.20: kontoret lægger hændelser sammen (knap og forslag), og Fotovagt lærer af det.
-- sammenlaegninger: hver sammenlægning (titler, afstand, tid) – bruges til at give bedre forslag og til nye regler.
-- ikke_samme: par, kontoret har sagt "ikke samme" til, så forslaget ikke kommer igen.
create table if not exists sammenlaegninger (
  id bigserial primary key,
  beholdt uuid references haendelser(id) on delete set null,
  fjernet uuid references haendelser(id) on delete set null,
  beholdt_titel text, fjernet_titel text, beholdt_kategori text, fjernet_kategori text,
  km numeric, minutter numeric,
  af uuid references profiles(id) on delete set null,
  tid timestamptz not null default now()
);
create table if not exists ikke_samme (
  a uuid not null references haendelser(id) on delete cascade,
  b uuid not null references haendelser(id) on delete cascade,
  af uuid references profiles(id) on delete set null,
  tid timestamptz not null default now(),
  primary key (a, b)
);
alter table sammenlaegninger enable row level security;
alter table ikke_samme enable row level security;
drop policy if exists saml_laes on sammenlaegninger;
create policy saml_laes on sammenlaegninger for select to authenticated using (er_kontor());
drop policy if exists ikke_laes on ikke_samme;
create policy ikke_laes on ikke_samme for select to authenticated using (er_kontor());

create or replace function slaa_sammen(behold uuid, fjern uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a haendelser; b haendelser; km numeric; linjer text;
begin
  if not er_kontor() then raise exception 'Kun kontoret kan lægge hændelser sammen'; end if;
  if behold = fjern then raise exception 'Vælg to forskellige hændelser'; end if;
  select * into a from haendelser where id = behold for update;
  select * into b from haendelser where id = fjern for update;
  if a.id is null or b.id is null then raise exception 'Hændelsen findes ikke'; end if;
  if b.status = 'annulleret' then raise exception 'Den anden hændelse er allerede annulleret'; end if;
  km := case when a.lat is not null and b.lat is not null then
    round((sqrt(power((a.lat - b.lat) * 111, 2) + power((a.lon - b.lon) * 111 * cos(radians(a.lat)), 2)))::numeric, 1) end;
  -- Den andens melding(er) føjes til teksten (med dens tidspunkt og kilde)
  linjer := (select string_agg(case when l ~ '^— ' then l
                 else '— kl. ' || to_char(b.oprettet at time zone 'Europe/Copenhagen', 'HH24.MI') || ' ' || coalesce(nullif(trim(b.app), ''), b.kilde, 'Lagt sammen') || ': ' || l end, E'\n')
             from unnest(string_to_array(coalesce(b.tekst, b.titel), E'\n')) l where trim(l) <> '');
  update haendelser set
    tekst = coalesce(a.tekst, '') || coalesce(E'\n' || linjer, ''),
    -- Præcis placering vinder over cirka
    lat = case when (a.lat is null or (a.cirka and not coalesce(b.cirka, true))) and b.lat is not null then b.lat else a.lat end,
    lon = case when (a.lat is null or (a.cirka and not coalesce(b.cirka, true))) and b.lat is not null then b.lon else a.lon end,
    adresse = case when (a.lat is null or (a.cirka and not coalesce(b.cirka, true))) and b.lat is not null and coalesce(b.adresse, '') <> '' then b.adresse else a.adresse end,
    cirka = case when (a.lat is null or (a.cirka and not coalesce(b.cirka, true))) and b.lat is not null then b.cirka else a.cirka end,
    nyheder = (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select distinct on (x->>'url') x from jsonb_array_elements(coalesce(a.nyheder, '[]') || coalesce(b.nyheder, '[]')) x) s),
    url = coalesce(a.url, b.url),
    prio = least(coalesce(a.prio, 2), coalesce(b.prio, 2)),
    eskaleret = coalesce(a.eskaleret, false) or coalesce(b.eskaleret, false),
    antal_ass = greatest(coalesce(a.antal_ass, 0), coalesce(b.antal_ass, 0)),
    antal_enheder = greatest(coalesce(a.antal_enheder, 0), coalesce(b.antal_enheder, 0)),
    -- Har kun den anden en fotograf, flyttes fotografen over
    taget_af = coalesce(a.taget_af, case when b.status in ('taget', 'ankommet') then b.taget_af end),
    taget_tid = coalesce(a.taget_tid, case when b.status in ('taget', 'ankommet') then b.taget_tid end),
    ankommet_tid = coalesce(a.ankommet_tid, case when b.status = 'ankommet' then b.ankommet_tid end),
    status = case when a.status = 'ny' and b.status in ('taget', 'ankommet') then b.status else a.status end
  where id = a.id;
  update profiles set haendelse_id = a.id where haendelse_id = b.id;
  update kommentarer set haendelse_id = a.id where haendelse_id = b.id;
  delete from tilbud where haendelse_id = b.id and svar is null;
  update haendelser set status = 'annulleret', offentlig = false, taget_af = null,
    note = trim(coalesce(note || ' · ', '') || 'Lagt sammen med "' || a.titel || '"')
  where id = b.id;
  insert into logbog (haendelse_id, handling) values
    (a.id, 'kontoret lagde "' || b.titel || '" sammen med denne'),
    (b.id, 'lagt sammen med "' || a.titel || '"');
  insert into sammenlaegninger (beholdt, fjernet, beholdt_titel, fjernet_titel, beholdt_kategori, fjernet_kategori, km, minutter, af)
  values (a.id, b.id, a.titel, b.titel, a.kategori, b.kategori, km, round(abs(extract(epoch from b.oprettet - a.oprettet)) / 60), auth.uid());
  return jsonb_build_object('ok', true, 'beholdt', a.id, 'km', km);
end $$;

create or replace function ikke_samme_par(x uuid, y uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not er_kontor() then raise exception 'Kun kontoret'; end if;
  insert into ikke_samme (a, b, af) values (least(x, y), greatest(x, y), auth.uid()) on conflict do nothing;
end $$;

-- Det, Fotovagt har lært: hvilke slags hændelser kontoret lægger sammen (typenøgle ud fra titlen)
create or replace function laerte_par() returns table (a text, b text, antal bigint, km_max numeric, min_max numeric)
language sql stable security definer set search_path = public as $$
  select least(type_noegle(beholdt_titel), type_noegle(fjernet_titel)), greatest(type_noegle(beholdt_titel), type_noegle(fjernet_titel)),
         count(*), max(km), max(minutter)
    from sammenlaegninger where er_kontor() and tid > now() - interval '1 year'
   group by 1, 2
$$;

revoke execute on function slaa_sammen(uuid, uuid), ikke_samme_par(uuid, uuid), laerte_par() from public, anon;
grant execute on function slaa_sammen(uuid, uuid), ikke_samme_par(uuid, uuid), laerte_par() to authenticated;

-- De sammenlægninger, der allerede er lavet i hånden i dag, så Fotovagt lærer af dem fra start
insert into sammenlaegninger (beholdt, fjernet, beholdt_titel, fjernet_titel, beholdt_kategori, fjernet_kategori, km, minutter)
select a.id, b.id, a.titel, b.titel, a.kategori, b.kategori,
  round((sqrt(power((a.lat - b.lat) * 111, 2) + power((a.lon - b.lon) * 111 * cos(radians(a.lat)), 2)))::numeric, 1),
  round(abs(extract(epoch from b.oprettet - a.oprettet)) / 60)
from haendelser b join haendelser a on b.note like 'Lagt sammen med%' and a.status <> 'annulleret'
  and a.oprettet between b.oprettet - interval '3 hours' and b.oprettet + interval '3 hours'
  and (b.note like '%' || a.titel || '%' or (b.note like '%samme adresse%' and a.adresse = b.adresse))
where b.status = 'annulleret' and b.oprettet > now() - interval '7 days'
  and not exists (select 1 from sammenlaegninger s where s.fjernet = b.id);

-- Forslag: aktive hændelser, der sandsynligvis er den samme (point ud fra afstand, tid, adresse, vej, station,
-- kategori, bilbrand, samme slags sted – og hvad kontoret tidligere har lagt sammen). Vises på kontoret med knapper.
create or replace function sammen_forslag() returns table (a uuid, b uuid, point int, km numeric, minutter int, grunde text[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not er_kontor() then raise exception 'Kun kontoret'; end if;
  return query
  with akt as (
    select h.*, type_noegle(h.titel) tn,
      lower(coalesce(h.titel, '') || ' ' || coalesce(h.adresse, '') || ' ' || array_to_string((string_to_array(coalesce(h.tekst, ''), E'\n'))[1:6], ' ')) t,
      lower(substring(coalesce(h.tekst, '') from '(?:^|\n)\S*\s*Station:\s*([^\n]+)')) st
    from haendelser h
    where h.status in ('ny', 'taget', 'ankommet') and h.oprettet > now() - interval '6 hours'
  ), par as (
    select x.id xa, y.id yb, x.tn xtn, y.tn ytn, x.t xt, y.t yt, x.st xst, y.st yst, x.kategori xk, y.kategori yk,
      x.adresse xadr, y.adresse yadr, x.cirka xc, y.cirka yc,
      round(abs(extract(epoch from y.oprettet - x.oprettet)) / 60)::int mn,
      case when x.lat is not null and y.lat is not null then
        round((sqrt(power((x.lat - y.lat) * 111, 2) + power((x.lon - y.lon) * 111 * cos(radians(x.lat)), 2)))::numeric, 1) end d
    from akt x join akt y on y.oprettet >= x.oprettet and y.id <> x.id
     and y.oprettet <= x.oprettet + interval '120 minutes'
    where not exists (select 1 from ikke_samme n where n.a = least(x.id, y.id) and n.b = greatest(x.id, y.id))
  ), s as (
    select p.*,
      array_remove(array[
        case when d < 0.3 then 'samme sted' when d < 2 then format('%s km fra hinanden', d) when d < 10 and not (xc or yc) then format('%s km fra hinanden', d) end,
        case when xadr ~ '\d' and lower(xadr) = lower(yadr) then 'samme adresse' end,
        case when exists (select 1 from regexp_matches(xt, '\m(e\d{2}|rute \d{1,3}|[a-zæøå]+ske motorvej)\M', 'g') m1
                          join regexp_matches(yt, '\m(e\d{2}|rute \d{1,3}|[a-zæøå]+ske motorvej)\M', 'g') m2 on m1[1] = m2[1]) then 'samme vej' end,
        case when exists (select 1 from regexp_matches(xt, '\m([a-zæøå]{3,}(?:vej|gade|allé|alle|stræde|vænget|parken|torv))\M', 'g') g1
                          join regexp_matches(yt, '\m([a-zæøå]{3,}(?:vej|gade|allé|alle|stræde|vænget|parken|torv))\M', 'g') g2 on g1[1] = g2[1]) then 'samme gade' end,
        case when xst is not null and xst = yst then 'samme station' end,
        case when xk = yk then 'samme kategori' end,
        case when xt ~ '(bilbrand|brand[- ]bil|btbf|køretøj (i brand|brænder)|bil (i brand|brænder))' and yt ~ '(bilbrand|brand[- ]bil|btbf|køretøj (i brand|brænder)|bil (i brand|brænder))' then 'begge bilbrand' end,
        case when exists (select 1 from regexp_matches(xt, '(lejlighed|villa|rækkehus|sommerhus|landbrug|stald|lade|industri|lager|butik|skole|plejehjem|carport|garage|container|lastbil|bus|traktor|båd|skib|tog|halm|skov)', 'g') o1
                          join regexp_matches(yt, '(lejlighed|villa|rækkehus|sommerhus|landbrug|stald|lade|industri|lager|butik|skole|plejehjem|carport|garage|container|lastbil|bus|traktor|båd|skib|tog|halm|skov)', 'g') o2 on o1[1] = o2[1]) then 'samme slags sted' end,
        case when exists (select 1 from sammenlaegninger l where least(type_noegle(l.beholdt_titel), type_noegle(l.fjernet_titel)) = least(xtn, ytn)
                            and greatest(type_noegle(l.beholdt_titel), type_noegle(l.fjernet_titel)) = greatest(xtn, ytn)) then 'kontoret har lagt den slags sammen før' end
      ], null) g
    from par p
    where d is null or d <= 30
  )
  select xa, yb,
    (case when d < 0.3 then 3 when d < 2 then 2 when d < 10 then 1 when (xc or yc) and d < 20 then 1 else 0 end
     + case when 'samme adresse' = any(g) then 3 else 0 end
     + case when 'samme vej' = any(g) then 2 else 0 end
     + case when 'samme gade' = any(g) then 2 else 0 end
     + case when 'samme station' = any(g) then 1 else 0 end
     + case when 'samme kategori' = any(g) then 1 else 0 end
     + case when 'begge bilbrand' = any(g) then 2 else 0 end
     + case when 'samme slags sted' = any(g) then 1 else 0 end
     + case when 'kontoret har lagt den slags sammen før' = any(g) then 2 else 0 end
     - case when not (xc or yc) and d > 3 then 3 else 0 end
     - case when mn > 60 then 1 else 0 end)::int,
    d, mn, g
  from s
  where (case when d < 0.3 then 3 when d < 2 then 2 when d < 10 then 1 when (xc or yc) and d < 20 then 1 else 0 end
     + case when 'samme adresse' = any(g) then 3 else 0 end + case when 'samme vej' = any(g) then 2 else 0 end
     + case when 'samme gade' = any(g) then 2 else 0 end + case when 'samme station' = any(g) then 1 else 0 end
     + case when 'samme kategori' = any(g) then 1 else 0 end + case when 'begge bilbrand' = any(g) then 2 else 0 end
     + case when 'samme slags sted' = any(g) then 1 else 0 end + case when 'kontoret har lagt den slags sammen før' = any(g) then 2 else 0 end
     - case when not (xc or yc) and d > 3 then 3 else 0 end - case when mn > 60 then 1 else 0 end) >= 5
  order by 3 desc;
end $$;
revoke execute on function sammen_forslag() from public, anon;
grant execute on function sammen_forslag() to authenticated;
