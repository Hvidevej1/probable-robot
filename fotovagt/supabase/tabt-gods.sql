-- Tabt gods: starter som lav prioritet og "hviler" – ingen automatiske tilbud, og derfor blinker den ikke på kontoret.
-- Den udvikler sig (prioritet normal + normalt forløb med tilbud/blink), når
--   * der kaldes assistance, eller en mere alvorlig melding lægges ind i den (titlen opgraderes), eller
--   * der sker et uheld/en ulykke inden for 1 km (inden for 6 timer).
-- Kontoret kan altid selv hæve prioriteten – så starter tilbuddene også.
-- Kør i Supabase -> SQL Editor efter isl-forespoergsel.sql.

create or replace function hviler(h haendelser) returns boolean language sql immutable as $$
  select coalesce(h.titel, '') ~* 'tabt gods' and coalesce(h.prio, 2) = 3 $$;

-- Lav prioritet ved start; normal når assistance kaldes eller titlen opgraderes (sammen med ISL-forespørgsel-reglen)
create or replace function isl_prio() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if (new.titel ~* 'forespørgsel' or new.titel ~* 'tabt gods') and coalesce(new.prio, 2) = 2 then new.prio := 3; end if;
  elsif old.prio = 3 and new.prio = 3 then
    if (split_part(coalesce(old.tekst, ''), E'\n', 1) ~* 'forespørgsel' or old.titel ~* 'forespørgsel')
       and tael_ass(new.tekst) > tael_ass(old.tekst) then
      new.prio := 2;
      insert into logbog (bruger, haendelse_id, handling)
        values (null, new.id, 'assistance kaldt efter ISL-forespørgsel – prioritet hævet fra lav til normal');
    elsif old.titel ~* 'tabt gods' and (tael_ass(new.tekst) > tael_ass(old.tekst) or coalesce(new.titel, '') !~* 'tabt gods') then
      new.prio := 2;
      insert into logbog (bruger, haendelse_id, handling)
        values (null, new.id, 'tabt gods har udviklet sig (' || case when tael_ass(new.tekst) > tael_ass(old.tekst) then 'assistance kaldt' else 'ny melding: ' || coalesce(new.titel, '') end || ') – prioritet hævet til normal');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists b_isl_prio on haendelser;
create trigger b_isl_prio before insert or update of tekst, titel on haendelser for each row execute function isl_prio();

-- Tilbud: ikke mens tabt gods hviler
create or replace function tilbud_start() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'ny' and new.lat is not null and new.tilbud_status is null and not coalesce(new.cirka, false)
     and coalesce(new.url, '') !~ 'pressemeddelelse' and not hviler(new)
     and (select auto_tilbud and not (coalesce(new.kategori, '') = any(kategorier_fra)) from indstillinger where id = 1) then
    update haendelser set tilbud_status = 'afventer', tilbud_start = now() where id = new.id and tilbud_status is null;
    if not tilbud_naeste(new.id) then
      update haendelser set tilbud_status = 'ingen_svar' where id = new.id;
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status = 'ny' and new.status <> 'ny' then
    update tilbud set svar = 'lukket', svar_tid = now() where haendelse_id = new.id and svar is null;
    if new.tilbud_status in ('afventer', 'ingen_svar') then
      update haendelser set tilbud_status = 'taget' where id = new.id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tilbud_start on haendelser;
create trigger tilbud_start after insert or update of lat, status on haendelser for each row execute function tilbud_start();

-- Hvilende hændelse vågner (prioritet hævet): start det normale forløb med tilbud
create or replace function vaagn() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.prio = 3 and new.prio < 3 and coalesce(old.titel, '') ~* 'tabt gods' and new.status = 'ny' and new.tilbud_status is null
     and new.lat is not null and not coalesce(new.cirka, false)
     and (select auto_tilbud and not (coalesce(new.kategori, '') = any(kategorier_fra)) from indstillinger where id = 1) then
    update haendelser set tilbud_status = 'afventer', tilbud_start = now() where id = new.id and tilbud_status is null;
    if not tilbud_naeste(new.id) then
      update haendelser set tilbud_status = 'ingen_svar' where id = new.id;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists vaagn on haendelser;
-- (på alle opdateringer: prioriteten kan også hæves af en anden udløser, fx når assistance lægges ind)
create trigger vaagn after update on haendelser for each row execute function vaagn();

-- Uheld/ulykke inden for 1 km af hvilende tabt gods: tabt gods vågner
create or replace function ulykke_naer_tabt_gods() returns trigger
language plpgsql security definer set search_path = public as $$
declare g record;
begin
  if new.lat is null or coalesce(new.titel, '') ~* 'tabt gods'
     or coalesce(new.titel, '') !~* '(uheld|ulykke|påkørsel|frontal|kollision|væltet|fastklemt|trafikuheld|fuh)' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.lat is not distinct from new.lat and old.lon is not distinct from new.lon then return null; end if;
  for g in select id from haendelser x
            where x.id <> new.id and hviler(x) and x.status in ('ny', 'taget', 'ankommet') and x.lat is not null
              and x.oprettet > now() - interval '6 hours' and km_mellem(x.lat, x.lon, new.lat, new.lon) < 1 loop
    insert into logbog (bruger, haendelse_id, handling)
      values (null, g.id, 'ulykke inden for 1 km (' || coalesce(new.titel, '') || ') – tabt gods hævet til normal');
    update haendelser set prio = 2 where id = g.id;
  end loop;
  return null;
end $$;
drop trigger if exists ulykke_naer_tabt_gods on haendelser;
create trigger ulykke_naer_tabt_gods after insert or update of lat, lon on haendelser for each row execute function ulykke_naer_tabt_gods();
revoke execute on function isl_prio(), tilbud_start(), vaagn(), ulykke_naer_tabt_gods() from public, anon, authenticated;

-- Aktive tabt gods, der ikke er taget: lav og hvilende (stopper blink)
update tilbud set svar = 'lukket', svar_tid = now()
 where svar is null and haendelse_id in (select id from haendelser where titel ~* 'tabt gods' and status = 'ny' and prio_tid is null);
update haendelser set prio = 3, tilbud_status = null
 where titel ~* 'tabt gods' and status = 'ny' and prio_tid is null;
