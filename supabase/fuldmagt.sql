-- Egen medicinliste pr. bruger + fuldmagt.
-- Hver bruger ejer sin egen medicin og sin egen CTR-saldo. En ejer kan give en
-- anden bruger fuldmagt, så den anden kan se og passe ejerens medicin.
-- Reglerne håndhæves i databasen (RLS), ikke kun i appen.
-- Kør i Supabase: "SQL Editor" -> "New query" -> indsæt -> "Run".

-- Hvem ejer medicinen (ny medicin får automatisk den indloggede som ejer)
alter table meds add column if not exists owner uuid references auth.users(id) on delete cascade default auth.uid();

-- Fuldmagt: grantee må se og passe owners medicin
create table if not exists fuldmagt (
  owner   uuid not null references auth.users(id) on delete cascade,
  grantee uuid not null references auth.users(id) on delete cascade,
  created timestamptz default now(),
  primary key (owner, grantee),
  check (owner <> grantee)
);

-- CTR-saldo og "danmark"-gruppe pr. ejer (saldoen skrives kun af FMK-hentningen)
create table if not exists ctr (
  owner      uuid primary key references auth.users(id) on delete cascade,
  saldo      numeric,
  period_end date,
  updated_on date,
  danmark    text default ''
);

-- Push: hvilken bruger hører telefonen til
alter table push_subscriptions add column if not exists user_id uuid references auth.users(id) on delete cascade default auth.uid();
update push_subscriptions p set user_id = u.id from auth.users u where p.user_id is null and lower(u.email) = lower(p.email);

-- Må den indloggede se denne ejers medicin?
create or replace function can_see(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_member() and (o = auth.uid() or exists (
    select 1 from fuldmagt f where f.owner = o and f.grantee = auth.uid()));
$$;

-- Brugerne af appen (navn fra profilen), kun for medlemmer
create or replace function app_users() returns table (id uuid, name text, email text)
language sql stable security definer set search_path = public as $$
  select u.id, coalesce(nullif(u.raw_user_meta_data ->> 'name', ''), split_part(u.email, '@', 1)), u.email::text
  from auth.users u join members m on lower(m.email) = lower(u.email)
  where is_member();
$$;

alter table fuldmagt enable row level security;
alter table ctr      enable row level security;

drop policy if exists "medlemmer" on meds;
drop policy if exists "ejer eller fuldmagt" on meds;
create policy "ejer eller fuldmagt" on meds for all to authenticated using (can_see(owner)) with check (can_see(owner));

drop policy if exists "ejer eller fuldmagt" on ctr;
create policy "ejer eller fuldmagt" on ctr for all to authenticated using (can_see(owner)) with check (can_see(owner));

-- Fuldmagter: begge parter kan se dem. Kun ejeren kan give. Begge kan fjerne.
drop policy if exists "se" on fuldmagt;
drop policy if exists "giv" on fuldmagt;
drop policy if exists "fjern" on fuldmagt;
create policy "se"    on fuldmagt for select to authenticated using (is_member() and (owner = auth.uid() or grantee = auth.uid()));
create policy "giv"   on fuldmagt for insert to authenticated with check (is_member() and owner = auth.uid());
create policy "fjern" on fuldmagt for delete to authenticated using (is_member() and (owner = auth.uid() or grantee = auth.uid()));

grant select, insert, update, delete on fuldmagt, ctr to authenticated, service_role;
grant execute on function can_see(uuid), app_users() to authenticated;

alter publication supabase_realtime add table fuldmagt, ctr;

-- Eksisterende medicin og CTR-saldo flyttes til den rigtige ejer med en
-- engangs-opdatering i SQL Editor (står ikke her, fordi den indeholder e-mailadresser):
--   update meds set owner = '<ejerens bruger-id>' where owner is null;
--   alter table meds alter column owner set not null;
