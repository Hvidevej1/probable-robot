-- Automatisk tilbud til nærmeste fotograf (trin 2 i PLAN-auto-tildeling.md).
-- Kør EFTER opsaetning.sql, push.sql og pushover-cron.sql. Ret RET_MIG_PROJEKT.
--
-- Forløb: Ny hændelse får placering -> tilbud til nærmeste LEDIGE fotograf (60 sek.)
--         -> nej / intet svar -> næstnærmeste (60 sek.) -> osv.
--         Er opgaven ikke taget efter 2 min, stopper tilbuddene, og den blinker på kontoret.

-- Indstillinger, som kontoret kan ændre
create table if not exists indstillinger (
  id int primary key default 1 check (id = 1),
  auto_tilbud boolean not null default true,      -- automatiske tilbud til/fra
  tilbud_sek int not null default 60,             -- hvor længe hver fotograf har til at svare
  blink_sek int not null default 120,             -- efter så lang tid blinker opgaven på kontoret
  max_km int not null default 35,                 -- fotografer længere væk end 35 km får ikke tilbud
  pos_max_min int not null default 30,             -- positioner ældre end 30 min tæller ikke
  kategorier_fra text[] not null default array['Forsyning']  -- ingen automatiske tilbud for disse
);
alter table indstillinger add column if not exists pos_max_min int not null default 30;
alter table indstillinger add column if not exists kategorier_fra text[] not null default array['Forsyning'];
insert into indstillinger (id) values (1) on conflict do nothing;
alter table indstillinger enable row level security;
drop policy if exists "laes" on indstillinger;
create policy "laes" on indstillinger for select to authenticated using (er_bruger());

-- Tilbud
create table if not exists tilbud (
  id uuid primary key default gen_random_uuid(),
  haendelse_id uuid not null references haendelser on delete cascade,
  fotograf uuid not null references profiles on delete cascade,
  nr int not null,                                 -- 1 = nærmeste, 2 = næstnærmeste …
  afstand_km double precision,
  sendt timestamptz not null default now(),
  udloeber timestamptz not null,
  svar text check (svar in ('ja', 'nej', 'udloebet', 'lukket')),
  svar_tid timestamptz
);
create index if not exists tilbud_aabne on tilbud (udloeber) where svar is null;
alter table tilbud enable row level security;
drop policy if exists "laes" on tilbud;
create policy "laes" on tilbud for select to authenticated using (fotograf = auth.uid() or er_kontor());

alter table haendelser add column if not exists tilbud_status text check (tilbud_status in ('afventer', 'ingen_svar', 'taget'));
alter table haendelser add column if not exists tilbud_start timestamptz;

-- Afstand i km (luftlinje)
create or replace function km_mellem(la1 double precision, lo1 double precision, la2 double precision, lo2 double precision)
returns double precision language sql immutable set search_path = public as $$
  select sqrt(power((la1 - la2) * 111.2, 2) + power((lo1 - lo2) * 111.2 * cos(radians(la1)), 2));
$$;

-- Send tilbud til den nærmeste ledige fotograf, der ikke har fået tilbud om denne opgave endnu.
-- Kun fotografer med frisk position (30 min) inden for 35 km. Ved lige afstand (±2 km) går tilbuddet
-- til den, der har ventet længst siden sin sidste opgave. Giver false, hvis der ikke er flere at spørge.
create or replace function tilbud_naeste(h uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare hh haendelser; ind indstillinger; f record; t uuid; n int;
begin
  select * into hh from haendelser where id = h;
  select * into ind from indstillinger where id = 1;
  if hh.id is null or hh.status <> 'ny' or hh.lat is null then return false; end if;
  select p.id, km_mellem(hh.lat, hh.lon, p.lat, p.lon) as d into f
    from profiles p
   where p.rolle = 'foto' and p.status = 'ledig' and p.lat is not null and p.haendelse_id is null
     and not exists (select 1 from tilbud x where x.haendelse_id = h and x.fotograf = p.id)
     and km_mellem(hh.lat, hh.lon, p.lat, p.lon) <= ind.max_km
     and p.pos_tid > now() - make_interval(mins => ind.pos_max_min)
   order by floor(km_mellem(hh.lat, hh.lon, p.lat, p.lon) / 2),
            (select max(x.taget_tid) from haendelser x where x.taget_af = p.id) asc nulls first,
            km_mellem(hh.lat, hh.lon, p.lat, p.lon)
   limit 1;
  if f.id is null then return false; end if;
  select coalesce(max(nr), 0) + 1 into n from tilbud where haendelse_id = h;
  insert into tilbud (haendelse_id, fotograf, nr, afstand_km, udloeber)
  values (h, f.id, n, f.d, now() + make_interval(secs => ind.tilbud_sek)) returning id into t;
  insert into logbog (bruger, haendelse_id, handling)
  values (null, h, format('tilbød opgaven til %s (%s km)', (select navn from profiles where id = f.id), round(f.d::numeric, 1)));
  perform net.http_post(
    url := 'https://RET_MIG_PROJEKT.supabase.co/functions/v1/push',
    body := jsonb_build_object('tilbud', t),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
  return true;
end $$;

-- Start tilbud, når en ny hændelse har fået en præcis placering.
-- Ikke ved cirka-placering (kun by/station), fravalgte kategorier eller politiets pressemeddelelser.
create or replace function tilbud_start() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'ny' and new.lat is not null and new.tilbud_status is null and not coalesce(new.cirka, false)
     and coalesce(new.url, '') !~ 'pressemeddelelse'
     and (select auto_tilbud and not (coalesce(new.kategori, '') = any(kategorier_fra)) from indstillinger where id = 1) then
    update haendelser set tilbud_status = 'afventer', tilbud_start = now() where id = new.id and tilbud_status is null;
    if not tilbud_naeste(new.id) then
      update haendelser set tilbud_status = 'ingen_svar' where id = new.id;   -- ingen ledige: kontoret med det samme
    end if;
  end if;
  -- Opgaven er taget (af tilbuddet, selv, eller af kontoret): luk åbne tilbud
  if tg_op = 'UPDATE' and old.status = 'ny' and new.status <> 'ny' then
    update tilbud set svar = 'lukket', svar_tid = now() where haendelse_id = new.id and svar is null;
    if new.tilbud_status in ('afventer', 'ingen_svar') then
      update haendelser set tilbud_status = 'taget' where id = new.id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tilbud_start on haendelser;
create trigger tilbud_start after insert or update of lat, status on haendelser
  for each row execute function tilbud_start();

-- Fotografen svarer på sit tilbud
create or replace function svar_tilbud(t uuid, ja boolean) returns void
language plpgsql security definer set search_path = public as $$
declare tt tilbud;
begin
  select * into tt from tilbud where id = t and fotograf = auth.uid();
  if tt.id is null then raise exception 'Tilbuddet findes ikke.'; end if;
  if tt.svar is not null or tt.udloeber < now() then raise exception 'Tilbuddet er udløbet eller lukket.'; end if;
  if ja then
    perform tag_haendelse(tt.haendelse_id);        -- fejler, hvis en anden har taget den
    update tilbud set svar = 'ja', svar_tid = now() where id = t;
  else
    update tilbud set svar = 'nej', svar_tid = now() where id = t;
    insert into logbog (bruger, haendelse_id, handling) values (auth.uid(), tt.haendelse_id, 'sagde nej tak til tilbuddet');
    if (select status from haendelser where id = tt.haendelse_id) = 'ny'
       and (select tilbud_status from haendelser where id = tt.haendelse_id) = 'afventer' then
      perform tilbud_naeste(tt.haendelse_id);       -- videre til næste med det samme
    end if;
  end if;
end $$;

-- Uret (hvert 5. sekund): udløbne tilbud -> næste fotograf; efter 2 min -> blink på kontoret
create or replace function tilbud_tjek() returns void
language plpgsql security definer set search_path = public as $$
declare r record; ind indstillinger;
begin
  select * into ind from indstillinger where id = 1;
  update tilbud set svar = 'udloebet', svar_tid = now() where svar is null and udloeber < now();
  for r in select id, tilbud_start from haendelser where tilbud_status = 'afventer' and status = 'ny' loop
    if now() - r.tilbud_start >= make_interval(secs => ind.blink_sek) then
      update tilbud set svar = 'lukket', svar_tid = now() where haendelse_id = r.id and svar is null;
      update haendelser set tilbud_status = 'ingen_svar' where id = r.id;
      insert into logbog (bruger, haendelse_id, handling) values (null, r.id, 'ingen tog tilbuddet – kontoret skal tildele');
    elsif not exists (select 1 from tilbud where haendelse_id = r.id and svar is null) then
      perform tilbud_naeste(r.id);                  -- hvis ingen flere: vent til tiden er gået, så blinker den
    end if;
  end loop;
end $$;

-- Kontoret slår automatikken til/fra
create or replace function saet_auto_tilbud(til boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not er_kontor() then raise exception 'Kun kontoret.'; end if;
  update indstillinger set auto_tilbud = til where id = 1;
  insert into logbog (bruger, handling) values (auth.uid(), case when til then 'slog automatiske tilbud til' else 'slog automatiske tilbud fra' end);
end $$;

revoke execute on function tilbud_naeste(uuid), tilbud_start(), tilbud_tjek() from public, anon, authenticated;
revoke execute on function svar_tilbud(uuid, boolean), saet_auto_tilbud(boolean) from public, anon;
grant execute on function svar_tilbud(uuid, boolean), saet_auto_tilbud(boolean) to authenticated;

do $$ begin
  begin alter publication supabase_realtime add table tilbud; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table indstillinger; exception when duplicate_object then null; end;
end $$;

select cron.unschedule('tilbud') where exists (select 1 from cron.job where jobname = 'tilbud');
select cron.schedule('tilbud', '5 seconds', $$ select public.tilbud_tjek() $$);
