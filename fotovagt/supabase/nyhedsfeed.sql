-- Fotovagt 15.20: nyheds-dashboard. Databasen henter 112-nyheder fra danske medier (RSS) hvert 5. minut,
-- frasorterer det, der ikke handler om brand, ulykker, politi og redning, og kobler automatisk nyheden til den
-- hændelse, den handler om (by/vej/gade + slags hændelse + tidspunkt). Kontoret kan også koble og fjerne i hånden.
create table if not exists nyhedsfeeds (
  id serial primary key,
  navn text not null,
  url text not null unique,
  aktiv boolean not null default true,
  sidst_hentet timestamptz,
  fejl text
);
create table if not exists nyhedsartikler (
  id bigserial primary key,
  feed_id int references nyhedsfeeds(id) on delete set null,
  kilde text,
  titel text not null,
  resume text,
  url text not null unique,
  udgivet timestamptz,
  hentet timestamptz not null default now(),
  kategori text,
  sted text,
  haendelse_id uuid references haendelser(id) on delete set null,
  koblet text check (koblet in ('auto', 'manuel')),
  koblet_af uuid references profiles(id) on delete set null,
  koblet_point int
);
create index if not exists nyhedsartikler_udgivet on nyhedsartikler (udgivet desc);
create table if not exists nyheds_koe (feed_id int primary key references nyhedsfeeds(id) on delete cascade, req_id bigint, sendt timestamptz);
alter table nyhedsfeeds enable row level security;
alter table nyhedsartikler enable row level security;
alter table nyheds_koe enable row level security;
drop policy if exists feeds_laes on nyhedsfeeds;
create policy feeds_laes on nyhedsfeeds for select to authenticated using (er_kontor());
drop policy if exists artikler_laes on nyhedsartikler;
create policy artikler_laes on nyhedsartikler for select to authenticated using (er_bruger());
alter publication supabase_realtime add table nyhedsartikler;

insert into nyhedsfeeds (navn, url) values
  ('DR', 'https://www.dr.dk/nyheder/service/feeds/allenyheder'),
  ('DR regionale', 'https://www.dr.dk/nyheder/service/feeds/regionale'),
  ('TV 2 Fyn', 'https://www.tv2fyn.dk/rss'),
  ('TV SYD', 'https://www.tvsyd.dk/rss'),
  ('TV2 Østjylland', 'https://www.tv2ostjylland.dk/rss'),
  ('TV2 Nord', 'https://www.tv2nord.dk/rss'),
  ('TV Midtvest', 'https://www.tvmidtvest.dk/rss'),
  ('TV 2 Kosmopol', 'https://www.tv2kosmopol.dk/rss'),
  ('TV 2 Øst', 'https://www.tv2east.dk/rss'),
  ('Ritzau (pressemeddelelser)', 'https://via.ritzau.dk/rss/releases/latest')
on conflict (url) do nothing;

-- Handler nyheden om 112-området? (brand, ulykker, politi, redning, beredskab, vejr med skader)
create or replace function er_112_nyhed(t text) returns boolean
language sql immutable set search_path = public as $$
  select lower(coalesce(t, '')) ~ '(\mbrand(?!s\M|ing)|\mild\M|\mrøg|eksplo|ulykke|\muheld\M|trafikuheld|færdselsuheld|påkør|kollision|frontal|væltet|spærret|\mpoliti(et|ets|kreds|kredse|betjent|betjente|aktion|anmeldelse)?\M|anholdt|varetægt|efterlys|savnet|eftersøg|drukn|redning|beredskab|brandvæsen|ambulance|lægehelikopter|knivstik|stukket ned|\mskud(t|det)?\M|skyderi|røveri|indbrud|overfald|\mvold(en|elig|eligt|tægt)?\M|\mdrab|dræbt|omkom|dødsulykke|evakuer|gasudslip|kemikal|forurening|oversvøm|skybrud|stormskade|væltede træer|hærværk|bombetrussel|mistænkelig genstand|havareret|uvejr|\mstorm(en|flod|vejr|varsel|fuld)?\M|orkan|isslag|glatføre|glat føre|snestorm|farlig vejrsituation|kraftig vind|vindstød|farevarsel)'
    -- ikke sport, politik, retssager og svindel – og ikke udlandet
    and lower(coalesce(t, '')) !~ '(fodbold|håndbold|superliga|landshold|aktie|valgkamp|folketingsvalg|kommunalvalg|politisk aftale|politikerne|opskrift|kriseråd|sikkerhedsbrud|svindl|\mdømt|\mdom(men)?\M|tiltalt|tiltale|landsret|byret|højesteret|retssag|nægter sig skyldig|fængsel|fængslet|\mstadfæst)'
    and lower(coalesce(t, '')) !~ '\m(i|fra|ved|nær) (usa|rusland|ukraine|gaza|israel|libanon|iran|irak|syrien|afghanistan|pakistan|kina|indien|japan|frankrig|storbritannien|england|spanien|italien|grækenland|tyrkiet|peru|brasilien|mexico|argentina|nigeria|sudan|congo|australien|canada)\M'
$$;

create or replace function nyhed_kategori(t text) returns text
language sql immutable set search_path = public as $$
  select case
    when lower(t) ~ '(brand|\mild\M|røg|eksplo|brænd)' then 'Brand'
    when lower(t) ~ '(ulykke|uheld|påkør|kollision|frontal|væltet|spærret|trafik|motorvej|\me\d{2}\M)' then 'Trafik'
    when lower(t) ~ '(drukn|redning|eftersøg|savnet|lægehelikopter|ambulance)' then 'Redning'
    when lower(t) ~ '(oversvøm|skybrud|storm)' then 'Vejr'
    when lower(t) ~ '(gasudslip|kemikal|forurening)' then 'Miljø'
    when lower(t) ~ '\mpoliti|anholdt|røveri|indbrud|knivstik|skud|drab|vold|efterlys' then 'Politi'
    else 'Andet' end
$$;

-- Byen i en hændelses adresse ("Sønderjyske Motorvej, 6052 Herslev" → herslev, "Faaborg" → faaborg)
create or replace function by_af(adresse text, omraade text) returns text
language sql immutable set search_path = public as $$
  select nullif(lower(trim(coalesce(
    substring(coalesce(omraade, '') from '([A-ZÆØÅ][A-Za-zÆØÅæøå\- ]+)$'),
    substring(coalesce(adresse, '') from '\d{4}\s+([^,]+?)(?:\s+[A-Z]{1,2})?$'),
    case when coalesce(adresse, '') !~ '\d' then split_part(adresse, ',', array_length(string_to_array(adresse, ','), 1)) end))), '')
$$;

-- Automatisk kobling: point for by, gade, vej, slags hændelse og tid. Kobles ved mindst 5 point.
create or replace function nyhed_kobl_auto(a_id bigint) returns uuid
language plpgsql security definer set search_path = public as $$
declare a nyhedsartikler; t text; best record;
begin
  select * into a from nyhedsartikler where id = a_id;
  if a.id is null or a.haendelse_id is not null then return a.haendelse_id; end if;
  t := lower(a.titel || ' ' || coalesce(a.resume, ''));
  select h.id, s.p into best
  from haendelser h,
  lateral (select
      (case when by_af(h.adresse, h.omraade) is not null and length(by_af(h.adresse, h.omraade)) >= 4
              and t ~ ('\m' || regexp_replace(by_af(h.adresse, h.omraade), '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '\M') then 3 else 0 end)
    + (case when exists (select 1 from regexp_matches(lower(coalesce(h.adresse, '') || ' ' || h.titel), '\m([a-zæøå]{4,}(?:vej|gade|allé|alle|stræde|vænget|parken|torv|højen|toften))\M', 'g') g
                        where t ~ ('\m' || g[1] || '\M')) then 3 else 0 end)
    + (case when exists (select 1 from regexp_matches(lower(coalesce(h.adresse, '') || ' ' || h.titel || ' ' || left(coalesce(h.tekst, ''), 400)), '\m(e\d{2}|rute \d{1,3})\M', 'g') v
                        where t ~ ('\m' || v[1] || '\M')) then 2 else 0 end)
    + (case when coalesce(h.kategori, 'Andet') = coalesce(a.kategori, '') then 2
            when h.kategori = 'Brand' and t ~ '(brand|brænd|ild)' then 2 else 0 end)
    + (case when a.udgivet between h.oprettet - interval '30 minutes' and h.oprettet + interval '3 hours' then 1 else 0 end) p) s
  where h.status <> 'annulleret' and h.oprettet between coalesce(a.udgivet, a.hentet) - interval '8 hours' and coalesce(a.udgivet, a.hentet) + interval '1 hour'
  order by s.p desc, abs(extract(epoch from coalesce(a.udgivet, a.hentet) - h.oprettet)) limit 1;
  if best.id is null or best.p < 5 then return null; end if;
  update nyhedsartikler set haendelse_id = best.id, koblet = 'auto', koblet_point = best.p where id = a.id;
  update haendelser set nyheder = coalesce(nyheder, '[]') || jsonb_build_array(jsonb_build_object('url', a.url, 'titel', a.titel, 'tid', coalesce(a.udgivet, now())))
   where id = best.id and not coalesce(nyheder, '[]') @> jsonb_build_array(jsonb_build_object('url', a.url));
  insert into logbog (haendelse_id, handling) values (best.id, 'nyhed koblet automatisk: ' || left(a.kilde || ' – ' || a.titel, 200));
  return best.id;
end $$;

-- Manuel kobling fra dashboardet (kun kontoret). haendelse = null fjerner koblingen.
create or replace function nyhed_kobl(artikel bigint, haendelse uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a nyhedsartikler;
begin
  if not er_kontor() then raise exception 'Kun kontoret'; end if;
  select * into a from nyhedsartikler where id = artikel;
  if a.id is null then raise exception 'Nyheden findes ikke'; end if;
  if a.haendelse_id is not null then
    update haendelser set nyheder = coalesce((select jsonb_agg(x) from jsonb_array_elements(nyheder) x where x->>'url' <> a.url), '[]') where id = a.haendelse_id;
  end if;
  update nyhedsartikler set haendelse_id = haendelse, koblet = case when haendelse is null then null else 'manuel' end, koblet_af = auth.uid(), koblet_point = null where id = artikel;
  if haendelse is not null then
    update haendelser set nyheder = coalesce(nyheder, '[]') || jsonb_build_array(jsonb_build_object('url', a.url, 'titel', a.titel, 'tid', coalesce(a.udgivet, now())))
     where id = haendelse and not coalesce(nyheder, '[]') @> jsonb_build_array(jsonb_build_object('url', a.url));
    insert into logbog (haendelse_id, handling) values (haendelse, 'kontoret koblede nyhed: ' || left(a.kilde || ' – ' || a.titel, 200));
  end if;
end $$;

create or replace function nyheder_hent() returns int
language plpgsql security definer set search_path = public as $$
declare f record; n int := 0;
begin
  for f in select * from nyhedsfeeds where aktiv loop
    insert into nyheds_koe (feed_id, req_id, sendt)
    values (f.id, net.http_get(f.url, headers := '{"User-Agent":"Fotovagt/15 https://vagt.hrc-fotos.dk"}'::jsonb, timeout_milliseconds := 15000), now())
    on conflict (feed_id) do update set req_id = excluded.req_id, sendt = now();
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function rens_xml_tekst(s text) returns text
language sql immutable set search_path = public as $$
  select nullif(trim(regexp_replace(regexp_replace(replace(replace(replace(replace(replace(
    regexp_replace(coalesce(s, ''), '^\s*<!\[CDATA\[|\]\]>\s*$', '', 'g'),
    '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&amp;', '&'),
    '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g')), '')
$$;

create or replace function nyheder_saml() returns int
language plpgsql security definer set search_path = public as $$
declare k record; i xml; titel text; link text; resume text; dato timestamptz; nyt bigint; n int := 0;
begin
  for k in select q.feed_id, f.navn, r.status_code, r.content from nyheds_koe q join nyhedsfeeds f on f.id = q.feed_id
             join net._http_response r on r.id = q.req_id loop
    if k.status_code = 200 then
      begin
        foreach i in array xpath('/rss/channel/item', k.content::xml) loop
          titel := rens_xml_tekst((xpath('/item/title/text()', i))[1]::text);
          link := trim(rens_xml_tekst((xpath('/item/link/text()', i))[1]::text));
          resume := left(rens_xml_tekst((xpath('/item/description/text()', i))[1]::text), 600);
          begin dato := rens_xml_tekst((xpath('/item/pubDate/text()', i))[1]::text)::timestamptz; exception when others then dato := now(); end;
          continue when titel is null or link !~ '^https?://' or dato < now() - interval '3 days';
          continue when not er_112_nyhed(titel || ' ' || coalesce(resume, ''));
          insert into nyhedsartikler (feed_id, kilde, titel, resume, url, udgivet, kategori)
          values (k.feed_id, k.navn, left(titel, 300), resume, link, least(dato, now()), nyhed_kategori(titel || ' ' || coalesce(resume, '')))
          on conflict (url) do nothing returning id into nyt;
          if nyt is not null then perform nyhed_kobl_auto(nyt); n := n + 1; nyt := null; end if;
        end loop;
        update nyhedsfeeds set sidst_hentet = now(), fejl = null where id = k.feed_id;
      exception when others then
        update nyhedsfeeds set sidst_hentet = now(), fejl = left(sqlerrm, 200) where id = k.feed_id;
      end;
    else
      update nyhedsfeeds set sidst_hentet = now(), fejl = 'HTTP ' || coalesce(k.status_code::text, '?') where id = k.feed_id;
    end if;
    delete from nyheds_koe where feed_id = k.feed_id;
  end loop;
  -- Ikke-koblede nyheder fra de seneste 3 timer prøves igen (hændelsen kan være kommet efter nyheden)
  perform nyhed_kobl_auto(id) from nyhedsartikler where haendelse_id is null and hentet > now() - interval '3 hours';
  delete from nyhedsartikler where udgivet < now() - interval '30 days' and haendelse_id is null;
  return n;
end $$;

revoke execute on function nyheder_hent(), nyheder_saml(), nyhed_kobl_auto(bigint) from public, anon, authenticated;
revoke execute on function nyhed_kobl(bigint, uuid) from public, anon;
grant execute on function nyhed_kobl(bigint, uuid) to authenticated;

select cron.unschedule(jobname) from cron.job where jobname in ('fotovagt-nyheder-hent', 'fotovagt-nyheder-saml');
select cron.schedule('fotovagt-nyheder-hent', '*/5 * * * *', $$select nyheder_hent();$$);
select cron.schedule('fotovagt-nyheder-saml', '* * * * *', $$select nyheder_saml();$$);
