-- Opsætning af den fælles database i Supabase.
-- Kør hele filen én gang i Supabase: "SQL Editor" -> "New query" -> indsæt -> "Run".
-- Husk at rette de to e-mailadresser nederst, før du kører den.

-- Hvem må se og rette listen
create table if not exists members (
  email text primary key
);

create table if not exists meds (
  id text primary key,
  name text not null,
  strength text,
  person text,
  kind text default 'recept',
  status text default 'bestil',
  runs_out date,
  note text,
  created timestamptz default now(),
  updated timestamptz default now(),
  price numeric,              -- tilskudspris i kr.
  tilskud boolean default true,
  updated_by text             -- e-mail på den, der sidst rettede
);
alter table meds add column if not exists price numeric;
alter table meds add column if not exists tilskud boolean default true;
alter table meds add column if not exists updated_by text;

create table if not exists products (
  id text primary key,
  name text not null,
  strength text,
  pack text,
  price text,
  varenr text,
  ean text
);

create table if not exists settings (
  id int primary key default 1,
  people text[] default array['Mig', 'Min kone'],
  remind_days int default 10,
  ctr jsonb default '{}'::jsonb   -- CTR-saldo og udløbsdato pr. person
);
alter table settings add column if not exists ctr jsonb default '{}'::jsonb;

-- Telefoner der vil have push-beskeder
create table if not exists push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  email text,
  created timestamptz default now()
);
insert into settings (id) values (1) on conflict do nothing;

-- Er den indloggede person på listen over medlemmer?
create or replace function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

-- Kun medlemmer kan læse og skrive. Medlemslisten selv kan ikke læses udefra.
alter table members  enable row level security;
alter table meds     enable row level security;
alter table products enable row level security;
alter table settings enable row level security;
alter table push_subscriptions enable row level security;

drop policy if exists "medlemmer" on meds;
drop policy if exists "medlemmer" on products;
drop policy if exists "medlemmer" on settings;
create policy "medlemmer" on meds     for all to authenticated using (is_member()) with check (is_member());
create policy "medlemmer" on products for all to authenticated using (is_member()) with check (is_member());
create policy "medlemmer" on settings for all to authenticated using (is_member()) with check (is_member());
drop policy if exists "medlemmer" on push_subscriptions;
create policy "medlemmer" on push_subscriptions for all to authenticated using (is_member()) with check (is_member());

-- Nye Supabase-projekter giver ikke selv adgang til tabeller lavet i SQL Editor
grant usage on schema public to authenticated;
grant select, insert, update, delete on meds, products, settings, push_subscriptions to authenticated;
grant execute on function is_member to authenticated;

-- Så den anden telefon får ændringer med det samme
alter publication supabase_realtime add table meds, products, settings;

-- RET DISSE TO til jeres egne e-mailadresser (de samme som I opretter som brugere)
insert into members (email) values
  ('din-email@eksempel.dk'),
  ('din-kones-email@eksempel.dk')
on conflict do nothing;
