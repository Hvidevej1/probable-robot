-- Fotovagt 15.30: ODIN (Beredskabsstyrelsens 1-1-2-puls) som ekstra kilde til hændelser.
-- RSS: http://www.odin.dk/RSS/RSS.aspx?beredskabsID=0 (hovedkilde) og ?beredskabsID=0000 (reserve: de seneste 20
-- alarmer for alle beredskaber – =0 var tom, da det blev sat op). Begge læses; samme alarm sendes kun én gang.
-- Adresserne står i tabellen odin_kilder og kan ændres der.
-- Kun http virker (https svarer ikke), og ODINs server afviser forespørgsler med ekstra headers.
-- Vilkår: "må kun bringes med tydelig kildeangivelse og link til www.odin.dk/112puls" (står i døgnrapporten).
-- Hver ny alarm sendes til Edge Function "pushover" som en webhook-besked i samme form som Pf-upload/Mast,
-- så den tolkes, placeres og lægges sammen med andre kilder om samme alarm på samme måde.
create table if not exists odin_set (noegle text primary key, set timestamptz not null default now());
create table if not exists odin_kilder (id int primary key, url text not null, aktiv boolean not null default true,
  req_id bigint, sendt timestamptz, sidst_ok timestamptz, sidst_antal int, fejl text);
insert into odin_kilder (id, url) values
  (1, 'http://www.odin.dk/RSS/RSS.aspx?beredskabsID=0'),
  (2, 'http://www.odin.dk/RSS/RSS.aspx?beredskabsID=0000')
on conflict (id) do nothing;
drop table if exists odin_koe;
alter table odin_set enable row level security;
alter table odin_kilder enable row level security;

create or replace function odin_hent() returns void
language plpgsql security definer set search_path = public as $$
begin
  -- (ingen ekstra headers: ODINs server svarer 400 på dem)
  update odin_kilder set req_id = net.http_get(url, timeout_milliseconds := 20000), sendt = now() where aktiv;
end $$;

create or replace function odin_saml() returns int
language plpgsql security definer set search_path = public as $$
declare r record; i xml; beredskab text; besk text; type text; station text; tid timestamptz; lokal text; k text; n int := 0; antal int;
begin
  for r in select q.id, q.req_id, s.status_code, s.content from odin_kilder q join net._http_response s on s.id = q.req_id loop
    if r.status_code is distinct from 200 then
      update odin_kilder set req_id = null, fejl = 'HTTP ' || coalesce(r.status_code::text, 'intet svar') where id = r.id;
      continue;
    end if;
    antal := 0;
    begin
      foreach i in array xpath('/rss/channel/item', regexp_replace(r.content, '^' || chr(65279), '')::xml) loop
        antal := antal + 1;
        beredskab := trim(rens_xml_tekst((xpath('/item/title/text()', i))[1]::text));
        besk := trim(rens_xml_tekst((xpath('/item/description/text()', i))[1]::text));
        lokal := trim(rens_xml_tekst((xpath('/item/comments/text()', i))[1]::text));
        begin tid := rens_xml_tekst((xpath('/item/pubDate/text()', i))[1]::text)::timestamptz; exception when others then tid := now(); end;
        continue when besk is null or tid < now() - interval '90 minutes';   -- ODIN kan være 30–90 min forsinket
        type := trim(regexp_replace(substring(besk from '^(?:Førstemelding:\s*)?(.*?)\s*Station:'), '\s+', ' ', 'g'));
        station := trim(substring(besk from 'Station:\s*(.+)$'));
        continue when coalesce(type, '') = '';
        -- Samme alarm i begge feeds giver samme nøgle og sendes kun én gang
        k := md5(coalesce(beredskab, '') || '|' || type || '|' || coalesce(station, '') || '|' || tid::text);
        continue when exists (select 1 from odin_set where noegle = k);
        insert into odin_set (noegle) values (k);
        -- Allerede kendt fra en anden kilde (Pf-upload/Mast) – også hvis den er lagt sammen med en anden hændelse
        continue when exists (select 1 from haendelser h where h.oprettet > tid - interval '30 minutes'
          and h.tekst ilike '%' || type || '%' and h.tekst ilike '%Station: ' || coalesce(station, '') || '%');
        -- Samme form som Mast/Pf-upload: "🔥 <type>", "Beredskab: …", "Station: …", tidspunkt
        perform net.http_post(
          url := 'https://uhhfqojbbslfcivykcxx.supabase.co/functions/v1/pushover',
          body := jsonb_build_object('title', '', 'app', 'ODIN', 'kilde', 'odin', 'id', 'odin-' || k,
            'message', '🔥 ' || type || E'\nBeredskab: ' || coalesce(beredskab, '') || E'\nStation: ' || coalesce(station, '') || E'\n' || coalesce(lokal, '')),
          headers := intern_headers(), timeout_milliseconds := 30000);
        n := n + 1;
      end loop;
      update odin_kilder set req_id = null, sidst_ok = now(), sidst_antal = antal, fejl = null where id = r.id;
    exception when others then
      update odin_kilder set req_id = null, fejl = left(sqlerrm, 200) where id = r.id;
    end;
  end loop;
  delete from odin_set where set < now() - interval '2 days';
  return n;
end $$;

revoke execute on function odin_hent(), odin_saml() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname in ('fotovagt-odin-hent', 'fotovagt-odin-saml');
select cron.schedule('fotovagt-odin-hent', '*/2 * * * *', $$select odin_hent();$$);
select cron.schedule('fotovagt-odin-saml', '* * * * *', $$select odin_saml();$$);
