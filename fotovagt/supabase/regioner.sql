-- Områder = Danmarks 5 regioner. Faste (kontoret kan kun ændre farven). Hændelsens region sættes med det samme ud fra
-- postnummeret og bekræftes af Nominatim-opslaget (address.state = "Region …"). Fotografens område kan skiftes løbende –
-- af kontoret (✎ på fotografen) og af fotografen selv i Marken.
-- Kør i Supabase -> SQL Editor efter omraader.sql og omraade-prioritet.sql.

insert into omraader (navn, farve) values
  ('Nordjylland', '#0ea5e9'), ('Midtjylland', '#16a34a'), ('Syddanmark', '#f59e0b'), ('Sjælland', '#8b5cf6'), ('Hovedstaden', '#e11d48')
on conflict (navn) do nothing;
-- Andre områder end regionerne fjernes (fotografer og hændelser i dem får intet område)
delete from omraader where navn not in ('Nordjylland', 'Midtjylland', 'Syddanmark', 'Sjælland', 'Hovedstaden');

drop policy if exists "kontor" on omraader;
drop policy if exists "kontor_farve" on omraader;
create policy "kontor_farve" on omraader for update to authenticated using (er_kontor()) with check (er_kontor());

-- Region ud fra postnummer (første bud – Nominatim bekræfter). Kommunegrænser, der krydser postnumre, er taget med.
create or replace function region_fra_postnr(pn int) returns text
language sql immutable as $$
  select case
    when pn is null then null
    when pn = 4050 then 'Hovedstaden'                                   -- Skibby (Frederikssund)
    when pn between 1000 and 3799 then 'Hovedstaden'
    when pn between 4000 and 4999 then 'Sjælland'
    when pn between 5000 and 6899 then 'Syddanmark'
    when pn between 6900 and 6999 then 'Midtjylland'
    when pn between 7130 and 7171 then 'Midtjylland'                    -- Hedensted Kommune
    when pn between 7000 and 7260 then 'Syddanmark'
    when pn between 7270 and 7280 then 'Midtjylland'
    when pn between 7300 and 7323 then 'Syddanmark'
    when pn = 7790 then 'Midtjylland'                                   -- Thyholm (Struer)
    when pn between 7700 and 7799 then 'Nordjylland'                    -- Thy
    when pn between 7900 and 7999 then 'Nordjylland'                    -- Mors
    when pn between 7330 and 8999 then 'Midtjylland'
    when pn = 9632 then 'Midtjylland'                                   -- Møldrup (Viborg)
    when pn between 9000 and 9999 then 'Nordjylland'
  end
$$;

create or replace function region_id(navn text) returns uuid language sql stable security definer set search_path = public as $$
  select id from omraader where omraader.navn = region_id.navn $$;

-- Hændelsens region: postnummeret i adressen (ellers venter vi på Nominatim)
create or replace function saet_omraade() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.lat is distinct from old.lat or new.lon is distinct from old.lon or new.adresse is distinct from old.adresse then
    new.omraade_id := coalesce(region_id(region_fra_postnr(substring(coalesce(new.adresse, '') from '\m(\d{4})\M')::int)),
                               case when tg_op = 'UPDATE' then old.omraade_id end);
  end if;
  return new;
end $$;
drop trigger if exists a_saet_omraade on haendelser;
create trigger a_saet_omraade before insert or update of lat, lon, adresse on haendelser for each row execute function saet_omraade();

-- Fotografen skifter selv område (fx når de arbejder i en anden region i en periode)
create or replace function skift_omraade(o uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not er_bruger() then raise exception 'Ikke adgang'; end if;
  if o is not null and not exists (select 1 from omraader where id = o) then raise exception 'Ukendt område'; end if;
  update profiles set omraade_id = o where id = auth.uid();
  insert into logbog (bruger, haendelse_id, handling)
    values (auth.uid(), null, 'skiftede område til ' || coalesce((select navn from omraader where id = o), 'intet'));
end $$;
revoke execute on function skift_omraade(uuid) from public, anon;
grant execute on function skift_omraade(uuid) to authenticated;

-- Eksisterende aktive hændelser
update haendelser set omraade_id = region_id(region_fra_postnr(substring(adresse from '\m(\d{4})\M')::int))
 where status in ('ny', 'taget', 'ankommet') and adresse ~ '\m\d{4}\M';

-- Regionen fra Nominatim-opslaget (omraade_behandl i kommentarer-doegnrapport.sql) er facit:
do $$ declare d text; begin
  d := pg_get_functiondef('public.omraade_behandl()'::regprocedure);
  if d ~ 'facit for hændelsens område' then return; end if;
  d := replace(d, $x$    if res is not null and res <> '' then update haendelser set omraade = res where id = r.haendelse_id; end if;$x$,
$x$    if res is not null and res <> '' then update haendelser set omraade = res where id = r.haendelse_id; end if;
    -- Regionen fra Nominatim ("Region Midtjylland") er facit for hændelsens område
    if a ? 'state' and region_id(regexp_replace(a->>'state', '^Region\s+', '')) is not null then
      update haendelser set omraade_id = region_id(regexp_replace(a->>'state', '^Region\s+', ''))
       where id = r.haendelse_id and omraade_id is distinct from region_id(regexp_replace(a->>'state', '^Region\s+', ''));
    end if;$x$);
  execute d;
end $$;
