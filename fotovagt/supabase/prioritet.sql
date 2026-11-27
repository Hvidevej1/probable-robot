-- Kontorets prioritering af hændelser: 1 = Høj, 2 = Normal, 3 = Lav. Kan ændres når som helst,
-- efterhånden som der kommer oplysninger ind. Bestemmer rækkefølgen i listerne og vises for fotograferne.
-- Hver ændring skrives i logbogen. Kør i Supabase -> SQL Editor.
alter table haendelser add column if not exists prio smallint not null default 2 check (prio in (1, 2, 3));
alter table haendelser add column if not exists prio_tid timestamptz;

-- (tidspunktet sættes før, logbogen skrives efter opdateringen, så den ikke rører samme række to gange)
create or replace function prio_tid() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.prio is distinct from old.prio then new.prio_tid := now(); end if;
  return new;
end $$;
create or replace function prio_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.prio is distinct from old.prio then
    insert into logbog (bruger, haendelse_id, handling)
      values (auth.uid(), new.id, 'satte prioritet til ' || case new.prio when 1 then 'høj' when 3 then 'lav' else 'normal' end);
  end if;
  return null;
end $$;
drop trigger if exists prio_tid on haendelser;
drop trigger if exists prio_log on haendelser;
create trigger prio_tid before update of prio on haendelser for each row execute function prio_tid();
create trigger prio_log after update of prio on haendelser for each row execute function prio_log();
revoke execute on function prio_log(), prio_tid() from public, anon, authenticated;
