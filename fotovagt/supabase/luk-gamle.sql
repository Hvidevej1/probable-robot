-- Hændelser uden opdateringer i 1,5 time lukkes automatisk. Kontoret kan genåbne dem (knappen "Genåbn").
-- En "opdatering" er:
--   - Pushover: en ekstra besked lagt ind i hændelsen (teksten ændres)
--   - kontoret: ret, tildel, luk, genåbn …
--   - fotografen: tag, ankommet, afslut …
-- Systemets egne handlinger (adresseopslag, automatiske tilbud) tæller ikke.
-- Kør i Supabase -> SQL Editor efter tilbud.sql.

alter table indstillinger add column if not exists luk_efter_min int not null default 90;
alter table haendelser add column if not exists sidst_aktiv timestamptz not null default now();
alter table haendelser add column if not exists auto_lukket boolean not null default false;
update haendelser set sidst_aktiv = greatest(oprettet, coalesce(ankommet_tid, oprettet), coalesce(taget_tid, oprettet))
 where sidst_aktiv > greatest(oprettet, coalesce(ankommet_tid, oprettet), coalesce(taget_tid, oprettet)) + interval '1 minute'
   and status in ('ny', 'taget', 'ankommet');

-- Ændringer i selve hændelsen
create or replace function haendelse_aktivitet() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.tekst, new.titel, new.adresse, new.status, new.taget_af, new.note, new.kategori)
     is distinct from (old.tekst, old.titel, old.adresse, old.status, old.taget_af, old.note, old.kategori) then
    new.sidst_aktiv := now();
  end if;
  if new.status = 'ny' and old.status in ('afsluttet', 'annulleret') then new.auto_lukket := false; end if;
  return new;
end $$;
drop trigger if exists haendelse_aktivitet on haendelser;
create trigger haendelse_aktivitet before update on haendelser for each row execute function haendelse_aktivitet();

-- Handlinger fra en person (kontor eller fotograf) i logbogen
create or replace function log_aktivitet() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.haendelse_id is not null and new.bruger is not null then
    update haendelser set sidst_aktiv = now() where id = new.haendelse_id and status in ('ny', 'taget', 'ankommet');
  end if;
  return new;
end $$;
drop trigger if exists log_aktivitet on logbog;
create trigger log_aktivitet after insert on logbog for each row execute function log_aktivitet();

-- Uret (hvert minut)
create or replace function luk_gamle() returns void
language plpgsql security definer set search_path = public as $$
declare r record; m int;
begin
  select luk_efter_min into m from indstillinger where id = 1;
  if coalesce(m, 0) <= 0 then return; end if;
  for r in select id from haendelser
            where status in ('ny', 'taget', 'ankommet') and sidst_aktiv < now() - make_interval(mins => m)
            for update skip locked loop
    update tilbud set svar = 'lukket', svar_tid = now() where haendelse_id = r.id and svar is null;
    -- en fotograf, der stadig står på opgaven, slippes (status ændres ikke)
    update profiles set haendelse_id = null where haendelse_id = r.id;
    update haendelser set status = 'afsluttet', afsluttet_tid = now(), auto_lukket = true where id = r.id;
    insert into logbog (bruger, haendelse_id, handling)
      values (null, r.id, 'lukket automatisk – ingen opdateringer i ' || replace(trim(to_char(m / 60.0, 'FM990.0')), '.', ',') || ' time');
  end loop;
end $$;
revoke execute on function haendelse_aktivitet(), log_aktivitet(), luk_gamle() from public, anon, authenticated;

select cron.unschedule('luk-gamle') where exists (select 1 from cron.job where jobname = 'luk-gamle');
select cron.schedule('luk-gamle', '* * * * *', $$ select public.luk_gamle() $$);
