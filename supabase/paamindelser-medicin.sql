-- Tilføjelse 2026-11-22: en påmindelse kan gælde bestemt medicin fra listen og håndkøb.
-- (Står også i paamindelser.sql. Denne fil er kun det nye, til et projekt der allerede har påmindelser.)
alter table paamindelser add column if not exists med_ids text[] not null default '{}';
alter table paamindelser add column if not exists produkt_ids text[] not null default '{}';

-- Funktionen skal laves igen, fordi tabellen har fået nye kolonner
drop function if exists paamindelser_nu();
create function paamindelser_nu() returns setof paamindelser
language sql stable security definer set search_path = public as $$
  with nu as (select (now() at time zone 'Europe/Copenhagen') as t)
  select p.* from paamindelser p, nu
  where p.aktiv
    and nu.t::date >= p.start_dato
    and (nu.t::date - p.start_dato) % p.hver = 0
    and nu.t::time - p.tid >= interval '0'
    and nu.t::time - p.tid < interval '30 minutes'
    and (p.sendt is null or (p.sendt at time zone 'Europe/Copenhagen')::date < nu.t::date);
$$;
revoke execute on function paamindelser_nu() from public, anon, authenticated;
grant execute on function paamindelser_nu() to service_role;
