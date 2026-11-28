-- Fotovagt 15.01: nyhedslinks på hændelser. Når en nyhed lægges sammen med en alarm, gemmes dens link
-- i haendelser.nyheder (i stedet for at gå tabt), og døgnrapporten linker til nyhederne.
alter table haendelser add column if not exists nyheder jsonb not null default '[]'::jsonb;

-- Et link til en artikel (ikke et kortlink eller en 112-kortside)
create or replace function er_nyhedslink(u text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(u ~* '^https?://[a-z0-9.-]+\.[a-z]{2,}(/|$)'
    and u !~* '^https?://([a-z0-9-]+\.)*(google\.[a-z.]+/maps|maps\.google\.|maps\.apple\.|goo\.gl/maps|openstreetmap\.|osm\.org|112meldinger\.dk|pushover\.net|waze\.com)'
    and u !~* '^https?://(www\.)?google\.[a-z.]+/(maps|search)', false)
$$;

-- Kun rene http(s)-links, højst 20, og nye hændelser fra en nyhed får linket med fra start
create or replace function nyheder_rens() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' and jsonb_array_length(coalesce(new.nyheder, '[]')) = 0 and er_nyhedslink(new.url) then
    new.nyheder := jsonb_build_array(jsonb_build_object('url', new.url, 'titel', left(new.titel, 200), 'tid', now()));
  end if;
  new.nyheder := coalesce((
    select jsonb_agg(jsonb_build_object('url', x->>'url', 'titel', left(coalesce(x->>'titel', ''), 200), 'tid', coalesce(x->>'tid', now()::text)))
      from (select x from jsonb_array_elements(coalesce(new.nyheder, '[]')) x
             where jsonb_typeof(x) = 'object' and er_nyhedslink(x->>'url') and length(x->>'url') < 1000 limit 20) s), '[]'::jsonb);
  return new;
end $$;
drop trigger if exists a_nyheder_rens on haendelser;
create trigger a_nyheder_rens before insert or update of nyheder on haendelser
  for each row execute function nyheder_rens();

-- Eksisterende hændelser, hvis link er en nyhed
update haendelser set nyheder = jsonb_build_array(jsonb_build_object('url', url, 'titel', left(titel, 200), 'tid', oprettet))
  where er_nyhedslink(url) and nyheder = '[]'::jsonb and oprettet > now() - interval '60 days';

revoke execute on function er_nyhedslink(text) from public, anon;
