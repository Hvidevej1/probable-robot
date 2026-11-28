-- Profilbilleder: et lille billede (ca. 160x160, JPEG, ~10 KB) pr. bruger, som kontoret og kollegerne kan se.
-- Ligger i sin egen tabel, så det ikke sendes med, hver gang en position opdateres.
-- Brugeren selv eller kontoret kan skifte/fjerne billedet. Kun brugere, der er logget ind, kan se dem.
-- Kør i Supabase -> SQL Editor.
create table if not exists profilfoto (
  id uuid primary key references profiles on delete cascade,
  foto text not null check (foto like 'data:image/jpeg;base64,%' and length(foto) < 150000),
  opdateret timestamptz not null default now()
);
alter table profilfoto enable row level security;
drop policy if exists "laes" on profilfoto;
create policy "laes" on profilfoto for select to authenticated using (er_bruger());
drop policy if exists "egen_eller_kontor" on profilfoto;
create policy "egen_eller_kontor" on profilfoto for all to authenticated
  using (id = auth.uid() or er_kontor()) with check (id = auth.uid() or er_kontor());
revoke all on table profilfoto from anon;
do $$ begin begin alter publication supabase_realtime add table profilfoto; exception when duplicate_object then null; end; end $$;
