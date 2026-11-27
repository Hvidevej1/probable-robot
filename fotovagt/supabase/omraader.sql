-- Geografiske områder og fotografernes udgangspunkt (bopæl/kontor), invitation på mail med område,
-- og kritiske ord, der kun tæller i sammenhæng med brand/udslip (kemikalier, bombe, granat, gas).
-- Kør i Supabase -> SQL Editor efter eskalering.sql og invitationer.sql. Ret RET_MIG_PROJEKT.

create table if not exists omraader (
  id uuid primary key default gen_random_uuid(),
  navn text not null unique,
  farve text not null default '#2f80ff',
  oprettet timestamptz not null default now()
);
alter table omraader enable row level security;
drop policy if exists "laes" on omraader;
create policy "laes" on omraader for select to authenticated using (er_bruger());
drop policy if exists "kontor" on omraader;
create policy "kontor" on omraader for all to authenticated using (er_kontor()) with check (er_kontor());
revoke all on table omraader from anon;
do $$ begin begin alter publication supabase_realtime add table omraader; exception when duplicate_object then null; end; end $$;

alter table profiles add column if not exists omraade_id uuid references omraader on delete set null;
alter table profiles add column if not exists base_adresse text;     -- bopæl/kontor, der køres ud fra
alter table profiles add column if not exists base_lat double precision;
alter table profiles add column if not exists base_lon double precision;
alter table invitationer add column if not exists omraade_id uuid references omraader on delete set null;

-- Ny bruger (kun inviterede) – nu også med område fra invitationen
create or replace function ny_bruger() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv invitationer;
begin
  select * into inv from invitationer where email = lower(trim(new.email));
  if not found then
    raise exception 'Denne e-mail er ikke inviteret til Fotovagt. Kontakt kontoret.' using errcode = '42501';
  end if;
  insert into profiles (id, navn, rolle, telefon, omraade_id)
  values (new.id, coalesce(nullif(trim(inv.navn), ''), new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), inv.rolle, inv.telefon, inv.omraade_id)
  on conflict (id) do nothing;
  update invitationer set brugt = now() where email = inv.email;
  return new;
end $$;
revoke execute on function ny_bruger() from public, anon, authenticated;

-- Tilbud: brug fotografens aktuelle position – eller udgangspunktet (bopæl/kontor), hvis positionen er gammel
create or replace function tilbud_naeste(h uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare hh haendelser; ind indstillinger; f record; t uuid; n int;
begin
  select * into hh from haendelser where id = h;
  select * into ind from indstillinger where id = 1;
  if hh.id is null or hh.status <> 'ny' or hh.lat is null then return false; end if;
  select p.id, km_mellem(hh.lat, hh.lon, q.la, q.lo) as d, q.base into f
    from profiles p
    cross join lateral (select
        case when p.lat is not null and p.pos_tid > now() - make_interval(mins => ind.pos_max_min) then p.lat else p.base_lat end as la,
        case when p.lat is not null and p.pos_tid > now() - make_interval(mins => ind.pos_max_min) then p.lon else p.base_lon end as lo,
        not (p.lat is not null and p.pos_tid > now() - make_interval(mins => ind.pos_max_min)) as base) q
   where p.rolle = 'foto' and p.status = 'ledig' and p.haendelse_id is null and q.la is not null
     and not exists (select 1 from tilbud x where x.haendelse_id = h and x.fotograf = p.id)
     and km_mellem(hh.lat, hh.lon, q.la, q.lo) <= ind.max_km
   order by floor(km_mellem(hh.lat, hh.lon, q.la, q.lo) / 2),
            (select max(x.taget_tid) from haendelser x where x.taget_af = p.id) asc nulls first,
            km_mellem(hh.lat, hh.lon, q.la, q.lo)
   limit 1;
  if f.id is null then return false; end if;
  select coalesce(max(nr), 0) + 1 into n from tilbud where haendelse_id = h;
  insert into tilbud (haendelse_id, fotograf, nr, afstand_km, udloeber)
  values (h, f.id, n, f.d, now() + make_interval(secs => ind.tilbud_sek)) returning id into t;
  insert into logbog (bruger, haendelse_id, handling)
  values (null, h, format('tilbød opgaven til %s (%s km%s)', (select navn from profiles where id = f.id), round(f.d::numeric, 1), case when f.base then ' fra udgangspunkt' else '' end));
  perform net.http_post(
    url := 'https://RET_MIG_PROJEKT.supabase.co/functions/v1/push',
    body := jsonb_build_object('tilbud', t),
    headers := jsonb_build_object('Content-Type', 'application/json'));
  return true;
end $$;
revoke execute on function tilbud_naeste(uuid) from public, anon, authenticated;

-- Kritiske ord, der kun tæller i sammenhæng (samme linje) med fx brand eller udslip
alter table indstillinger add column if not exists eskaler_ord_kontekst text not null default 'kemikalie\w*|bombe\w*|granat\w*|gas\w*';
alter table indstillinger add column if not exists eskaler_kontekst text not null default 'brand\w*|ild|røg\w*|udslip\w*|læk\w*|eksplo\w*|spræng\w*|forurening\w*|udstrømning\w*|evakuer\w*|ledningsbrud\w*|fund\w*|fundet|trussel\w*|mistænkelig\w*|rydning\w*|antændt';

create or replace function eskalering_tjek() returns trigger
language plpgsql security definer set search_path = public as $$
declare ind indstillinger; ok_ass boolean; ok_enh boolean; ok_ord boolean; aba boolean; ord text; alt text; l text; stammer text;
begin
  new.antal_ass := tael_ass(new.tekst);
  new.antal_enheder := tael_enheder(new.tekst);
  if new.eskalering_forslag is null and not new.eskaleret and not new.eskalering_afvist
     and new.status in ('ny', 'taget', 'ankommet') then
    select * into ind from indstillinger where id = 1;
    alt := lower(coalesce(new.titel, '') || E'\n' || coalesce(new.tekst, ''));
    ok_ass := new.antal_ass > coalesce(ind.eskaler_ass, 3);
    -- Automatiske brandalarmer (ABA) sendes ofte med mange enheder og er som regel falske: tæller ikke på enheder alene
    aba := coalesce(new.titel, '') ~* '(\maba\d*\M|automatisk brandalarm)';
    ok_enh := new.antal_enheder > coalesce(ind.eskaler_enheder, 4) and not aba;
    -- Ord, der altid er kritiske (elbil, færge …)
    ord := case when coalesce(ind.eskaler_ord, '') <> '' then (regexp_match(alt, '\m(' || lower(ind.eskaler_ord) || ')\M'))[1] end;
    -- Ord, der kun er kritiske sammen med brand/udslip m.m. i samme linje (kemikalier, bombe, granat, gas)
    if ord is null and coalesce(ind.eskaler_ord_kontekst, '') <> '' then
      stammer := replace(lower(ind.eskaler_ord_kontekst), '\w*', '');
      foreach l in array string_to_array(alt, E'\n') loop
        -- Stationens navn ("Brand & Redning", "brandvæsen") tæller ikke som sammenhæng
        l := regexp_replace(l, 'brand\s*(?:væsen\w*|station\w*|og redning|&\s*redning)|beredskab\w*', ' ', 'g');
        -- Sammenhæng i samme linje – også i sammensatte ord som gasudslip, bombetrussel, kemikaliebrand
        if l ~ ('\m(' || lower(ind.eskaler_kontekst) || ')\M') or l ~ ('\m(' || stammer || ')\w*(' || lower(ind.eskaler_kontekst) || ')') then
          ord := (regexp_match(l, '\m(' || lower(ind.eskaler_ord_kontekst) || ')\M'))[1];
          exit when ord is not null;
        end if;
      end loop;
    end if;
    ok_ord := ord is not null;
    if ok_ord or (coalesce(ind.eskaler_begge, false) and ok_ass and ok_enh) or (not coalesce(ind.eskaler_begge, false) and (ok_ass or ok_enh)) then
      new.eskalering_forslag := now();
      new.eskalering_grund := concat_ws(' · ',
        case when ok_ord then 'nævner "' || ord || '"' end,
        case when ok_enh then new.antal_enheder || ' enheder' end,
        case when ok_ass then new.antal_ass || ' assistancer' end);
    end if;
  end if;
  return new;
end $$;
revoke execute on function eskalering_tjek() from public, anon, authenticated;
