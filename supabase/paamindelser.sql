-- Påmindelser om at tage medicin og om at fylde doseringsæsken.
-- Hver bruger har sine egne påmindelser, og de sendes kun til brugerens egne
-- telefoner. Kør EFTER push.sql og fuldmagt.sql.
-- Kør i Supabase: "SQL Editor" -> "New query" -> indsæt -> "Run".

create table if not exists paamindelser (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  slags      text not null default 'medicin' check (slags in ('medicin', 'doseringsaeske')),
  tekst      text,                         -- fx "Morgen" (valgfri)
  tid        time not null,                -- dansk tid
  start_dato date not null default current_date,
  hver       int  not null default 1 check (hver between 1 and 60), -- hver dag = 1, hver 14. dag = 14
  aktiv      boolean not null default true,
  sendt      timestamptz,                  -- sidst sendt
  created    timestamptz default now()
);

-- Hvilken medicin påmindelsen gælder (id'er fra medicinlisten og fra håndkøb)
alter table paamindelser add column if not exists med_ids text[] not null default '{}';
alter table paamindelser add column if not exists produkt_ids text[] not null default '{}';

alter table paamindelser enable row level security;
drop policy if exists "egne" on paamindelser;
create policy "egne" on paamindelser for all to authenticated
  using (is_member() and user_id = auth.uid()) with check (is_member() and user_id = auth.uid());
grant select, insert, update, delete on paamindelser to authenticated, service_role;

-- Påmindelser, der skal sendes nu: tidspunktet er nået inden for de sidste
-- 30 minutter, det er en dag, hvor den gælder, og den er ikke sendt i dag.
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

-- Hvert minut: er der noget at sende, kaldes send-push.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('medicin-paamindelser') where exists (select 1 from cron.job where jobname = 'medicin-paamindelser');
select cron.schedule('medicin-paamindelser', '* * * * *', $$
  select net.http_post(
    url := 'https://andmqexhvvidvebsosgw.supabase.co/functions/v1/send-push',
    body := '{"paamindelser": true}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  ) where exists (select 1 from paamindelser_nu());
$$);
