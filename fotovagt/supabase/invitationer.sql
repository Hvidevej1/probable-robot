-- Kun inviterede kan oprette en bruger.
-- Supabase tillader som standard, at alle opretter en konto. Uden denne fil fik enhver ny konto en
-- fotografprofil og kunne se hændelser, adresser og fotografernes positioner.
-- Nu skal kontoret først invitere e-mailadressen (i Fotovagt: Fotografer → Inviter). Alle andre
-- afvises, allerede når kontoen oprettes – også hvis den oprettes i Supabase-dashboardet.
-- Kør i Supabase -> SQL Editor.

create table if not exists invitationer (
  email text primary key check (email = lower(trim(email)) and email like '%@%'),
  navn text,
  rolle text not null default 'foto' check (rolle in ('foto', 'kontor')),
  telefon text,
  inviteret_af uuid references profiles on delete set null,
  oprettet timestamptz not null default now(),
  brugt timestamptz
);
alter table invitationer enable row level security;
drop policy if exists "kontor" on invitationer;
create policy "kontor" on invitationer for all to authenticated using (er_kontor()) with check (er_kontor());

-- Ny bruger: kun hvis e-mailen er inviteret. Profilen får navn, rolle og telefon fra invitationen.
create or replace function ny_bruger() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv invitationer;
begin
  select * into inv from invitationer where email = lower(trim(new.email));
  if not found then
    raise exception 'Denne e-mail er ikke inviteret til Fotovagt. Kontakt kontoret.' using errcode = '42501';
  end if;
  insert into profiles (id, navn, rolle, telefon)
  values (new.id, coalesce(nullif(trim(inv.navn), ''), new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), inv.rolle, inv.telefon)
  on conflict (id) do nothing;
  update invitationer set brugt = now() where email = inv.email;
  return new;
end $$;
revoke execute on function ny_bruger() from public, anon, authenticated;

-- De nuværende brugere står som allerede inviteret
insert into invitationer (email, navn, rolle, brugt)
select lower(u.email), p.navn, p.rolle, u.created_at from auth.users u join profiles p on p.id = u.id
on conflict (email) do nothing;

-- Ekstra sikring: uden login kan man ikke røre tabellerne direkte (adgangsreglerne afviser det
-- allerede, men så er der to låse). Døgnrapporten bruger kun funktionen doegnrapport().
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke all on table public.%I from anon', t);
  end loop;
end $$;
alter default privileges in schema public revoke all on tables from anon;

-- Beskeder, Fotovagt springer over (radioprøver, kontorets ignorér-liste m.m.), så kontoret kan se dem i 7 dage
create table if not exists ignorerede (
  id bigserial primary key,
  tid timestamptz not null default now(),
  app text, titel text, grund text
);
alter table ignorerede enable row level security;
drop policy if exists "kontor" on ignorerede;
create policy "kontor" on ignorerede for select to authenticated using (er_kontor());
revoke all on table ignorerede from anon;
select cron.unschedule('ryd-ignorerede') where exists (select 1 from cron.job where jobname = 'ryd-ignorerede');
select cron.schedule('ryd-ignorerede', '23 3 * * *', $$ delete from public.ignorerede where tid < now() - interval '7 days' $$);
