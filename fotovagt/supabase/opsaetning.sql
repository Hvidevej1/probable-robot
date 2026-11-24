-- Fotovagt: opsætning af databasen i Supabase.
-- Kør hele filen i et NYT Supabase-projekt: "SQL Editor" -> "New query" -> indsæt -> "Run".
-- Filen kan køres igen uden at slette data.

create extension if not exists pgcrypto;

-- Brugere: fotografer i marken og folk på kontoret ----------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  navn text not null default '',
  telefon text,
  rolle text not null default 'foto' check (rolle in ('foto', 'kontor')),
  status text not null default 'offline' check (status in ('offline', 'ledig', 'optaget', 'pause', 'ankommet')),
  status_tid timestamptz default now(),
  haendelse_id uuid,                 -- den opgave fotografen har taget lige nu
  lat double precision,              -- seneste position (kun hvis fotografen har tilladt det)
  lon double precision,
  pos_tid timestamptz,
  sidst_set timestamptz              -- appen melder sig hvert minut, mens den er åben
);

-- Hændelser: kommer automatisk fra Pushover eller oprettes på kontoret ----------------
create table if not exists haendelser (
  id uuid primary key default gen_random_uuid(),
  oprettet timestamptz not null default now(),
  kilde text not null default 'manuel',          -- pushover, webhook, manuel
  ekstern_id text unique,                        -- fx Pushover-beskedens id, så intet kommer to gange
  titel text not null,
  tekst text,
  adresse text,
  kategori text default 'Andet',
  prioritet int default 0,
  url text,
  app text,                                      -- Pushover-appens navn (afsender)
  lat double precision,
  lon double precision,
  status text not null default 'ny' check (status in ('ny', 'taget', 'ankommet', 'afsluttet', 'annulleret')),
  taget_af uuid references profiles on delete set null,
  taget_tid timestamptz,
  ankommet_tid timestamptz,
  afsluttet_tid timestamptz,
  note text
);
create index if not exists haendelser_aktive on haendelser (oprettet desc) where status in ('ny', 'taget', 'ankommet');

alter table profiles drop constraint if exists profiles_haendelse_fk;
alter table profiles add constraint profiles_haendelse_fk foreign key (haendelse_id) references haendelser on delete set null;

-- Logbog: hvem gjorde hvad og hvornår ------------------------------------------------
create table if not exists logbog (
  id bigint generated always as identity primary key,
  tid timestamptz not null default now(),
  bruger uuid references profiles on delete set null,
  haendelse_id uuid references haendelser on delete cascade,
  handling text not null
);
create index if not exists logbog_tid on logbog (tid desc);

-- Pushover-forbindelsen. Kun Edge Function kan læse den (ingen adgang for brugere).
create table if not exists pushover_konto (
  id int primary key default 1 check (id = 1),
  secret text,
  device_id text,
  highest bigint default 0,
  kun_apps text[],                               -- tom = alle beskeder bliver til hændelser
  sidst_hentet timestamptz,
  fejl text
);
insert into pushover_konto (id) values (1) on conflict do nothing;

-- Ny bruger i Authentication -> får automatisk en profil som fotograf ----------------
create or replace function ny_bruger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, navn)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists ny_bruger on auth.users;
create trigger ny_bruger after insert on auth.users for each row execute function ny_bruger();
insert into profiles (id, navn) select id, split_part(email, '@', 1) from auth.users on conflict do nothing;

-- Hjælpere ---------------------------------------------------------------------------
create or replace function er_kontor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and rolle = 'kontor');
$$;
create or replace function er_bruger() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid());
$$;
create or replace function skriv_log(h uuid, tekst text) returns void
language sql security definer set search_path = public as $$
  insert into logbog (bruger, haendelse_id, handling) values (auth.uid(), h, tekst);
$$;
revoke execute on function skriv_log(uuid, text) from public, anon, authenticated;

-- Adgang (Row Level Security) ----------------------------------------------------------
-- Alle indloggede kan SE alt. Fotografer ændrer kun via funktionerne herunder.
-- Kontoret må rette direkte i hændelser og profiler.
alter table profiles enable row level security;
alter table haendelser enable row level security;
alter table logbog enable row level security;
alter table pushover_konto enable row level security;

drop policy if exists "laes" on profiles;
drop policy if exists "kontor" on profiles;
create policy "laes" on profiles for select to authenticated using (er_bruger());
create policy "kontor" on profiles for update to authenticated using (er_kontor()) with check (er_kontor());

drop policy if exists "laes" on haendelser;
drop policy if exists "kontor" on haendelser;
create policy "laes" on haendelser for select to authenticated using (er_bruger());
create policy "kontor" on haendelser for all to authenticated using (er_kontor()) with check (er_kontor());

drop policy if exists "laes" on logbog;
create policy "laes" on logbog for select to authenticated using (er_bruger());

-- Fotografens handlinger --------------------------------------------------------------
-- Tag en hændelse. Kun én kan få den: den der kommer først.
create or replace function tag_haendelse(h uuid) returns void
language plpgsql security definer set search_path = public as $$
declare aktiv uuid;
begin
  select haendelse_id into aktiv from profiles where id = auth.uid();
  if aktiv is not null and aktiv <> h then
    raise exception 'Du har allerede en opgave. Afslut eller slip den først.';
  end if;
  update haendelser set status = 'taget', taget_af = auth.uid(), taget_tid = now()
   where id = h and status = 'ny';
  if not found then
    raise exception 'Hændelsen er allerede taget af en anden.';
  end if;
  update profiles set haendelse_id = h, status = 'optaget', status_tid = now(), sidst_set = now()
   where id = auth.uid();
  perform skriv_log(h, 'tog hændelsen');
end $$;

-- Meld status: ledig, optaget, pause eller ankommet.
create or replace function meld_status(s text) returns void
language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if s not in ('ledig', 'optaget', 'pause', 'ankommet', 'offline') then
    raise exception 'Ukendt status %', s;
  end if;
  select haendelse_id into h from profiles where id = auth.uid();
  if s = 'ankommet' and h is null then
    raise exception 'Du har ingen opgave at være ankommet til.';
  end if;
  update profiles set status = s, status_tid = now(), sidst_set = now() where id = auth.uid();
  if s = 'ankommet' then
    update haendelser set status = 'ankommet', ankommet_tid = coalesce(ankommet_tid, now()) where id = h;
  end if;
  perform skriv_log(h, 'meldte ' || s);
end $$;

-- Afslut opgaven (billederne er taget) eller slip den, så en anden kan tage den.
create or replace function afslut_haendelse(note_tekst text default null) returns void
language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  select haendelse_id into h from profiles where id = auth.uid();
  if h is null then raise exception 'Du har ingen opgave.'; end if;
  update haendelser set status = 'afsluttet', afsluttet_tid = now(),
         note = coalesce(nullif(note_tekst, ''), note) where id = h;
  update profiles set haendelse_id = null, status = 'ledig', status_tid = now(), sidst_set = now() where id = auth.uid();
  perform skriv_log(h, 'afsluttede opgaven' || coalesce(': ' || nullif(note_tekst, ''), ''));
end $$;

create or replace function slip_haendelse() returns void
language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  select haendelse_id into h from profiles where id = auth.uid();
  if h is null then raise exception 'Du har ingen opgave.'; end if;
  update haendelser set status = 'ny', taget_af = null, taget_tid = null, ankommet_tid = null where id = h;
  update profiles set haendelse_id = null, status = 'ledig', status_tid = now(), sidst_set = now() where id = auth.uid();
  perform skriv_log(h, 'slap opgaven');
end $$;

-- Appen melder sig hvert minut (med position, hvis fotografen har sagt ja til det).
create or replace function meld_position(la double precision default null, lo double precision default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  update profiles set sidst_set = now(),
         lat = coalesce(la, lat), lon = coalesce(lo, lon),
         pos_tid = case when la is not null then now() else pos_tid end
   where id = auth.uid();
end $$;

-- Ret eget navn og telefonnummer
create or replace function ret_profil(nyt_navn text, ny_telefon text) returns void
language sql security definer set search_path = public as $$
  update profiles set navn = coalesce(nullif(trim(nyt_navn), ''), navn), telefon = nullif(trim(ny_telefon), '')
   where id = auth.uid();
$$;

-- Kontorets handlinger ----------------------------------------------------------------
-- Giv en hændelse til en bestemt fotograf (eller tag den fra, med foto = null).
create or replace function tildel_haendelse(h uuid, foto uuid) returns void
language plpgsql security definer set search_path = public as $$
declare gammel uuid; navn_ text;
begin
  if not er_kontor() then raise exception 'Kun kontoret kan tildele.'; end if;
  select taget_af into gammel from haendelser where id = h;
  if gammel is not null then
    update profiles set haendelse_id = null, status = 'ledig', status_tid = now() where id = gammel and haendelse_id = h;
  end if;
  if foto is null then
    update haendelser set status = 'ny', taget_af = null, taget_tid = null, ankommet_tid = null where id = h;
    perform skriv_log(h, 'fjernede fotografen fra opgaven');
    return;
  end if;
  if exists (select 1 from profiles where id = foto and haendelse_id is not null and haendelse_id <> h) then
    raise exception 'Fotografen har allerede en opgave.';
  end if;
  update haendelser set status = 'taget', taget_af = foto, taget_tid = now(), ankommet_tid = null where id = h;
  update profiles set haendelse_id = h, status = 'optaget', status_tid = now() where id = foto;
  select navn into navn_ from profiles where id = foto;
  perform skriv_log(h, 'gav opgaven til ' || navn_);
end $$;

-- Afslut eller annullér fra kontoret
create or replace function luk_haendelse(h uuid, ny_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not er_kontor() then raise exception 'Kun kontoret kan lukke hændelser.'; end if;
  if ny_status not in ('afsluttet', 'annulleret', 'ny') then raise exception 'Ukendt status'; end if;
  update profiles set haendelse_id = null, status = 'ledig', status_tid = now() where haendelse_id = h;
  update haendelser set status = ny_status,
         afsluttet_tid = case when ny_status = 'ny' then null else now() end,
         taget_af = case when ny_status = 'ny' then null else taget_af end
   where id = h;
  perform skriv_log(h, case ny_status when 'ny' then 'genåbnede hændelsen' else 'satte hændelsen til ' || ny_status end);
end $$;

-- Sæt en fotografs status fra kontoret (fx hvis en har glemt at melde sig af)
create or replace function saet_status(foto uuid, s text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not er_kontor() then raise exception 'Kun kontoret.'; end if;
  update profiles set status = s, status_tid = now() where id = foto;
  insert into logbog (bruger, handling) values (auth.uid(),
    'satte ' || (select navn from profiles where id = foto) || ' til ' || s);
end $$;

-- Log nye hændelser
create or replace function ny_haendelse_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into logbog (bruger, haendelse_id, handling)
  values (auth.uid(), new.id, case new.kilde when 'manuel' then 'oprettede hændelsen' else 'ny hændelse fra ' || new.kilde end);
  return new;
end $$;
drop trigger if exists ny_haendelse_log on haendelser;
create trigger ny_haendelse_log after insert on haendelser for each row execute function ny_haendelse_log();

-- Live-opdatering af kort og lister
do $$ begin
  begin alter publication supabase_realtime add table haendelser; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table profiles; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table logbog; exception when duplicate_object then null; end;
end $$;

-- Gør dig selv til kontor-bruger: ret e-mailen og kør linjen (efter du har oprettet brugeren).
-- update profiles set rolle = 'kontor' where id = (select id from auth.users where email = 'din@mail.dk');
