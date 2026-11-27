-- Fotograferne kører først i deres eget område. Hændelsen hører til det område, hvis fotograf har sit
-- udgangspunkt (bopæl/kontor) nærmest. Tilbud går først til fotografer i området (og fotografer uden
-- område). Fotografer i nabo-områderne får kun tilbuddet, hvis hændelsen har HØJ prioritet og ingen i
-- området har taget den – eller hvis området slet ingen fotografer har.
-- Sætter kontoret prioriteten til høj, efter at området har sagt nej, går tilbuddet videre til naboerne.
-- Kør i Supabase -> SQL Editor efter omraader.sql. Ret RET_MIG_PROJEKT.

alter table haendelser add column if not exists omraade_id uuid references omraader on delete set null;

create or replace function omraade_for(la double precision, lo double precision) returns uuid
language sql stable security definer set search_path = public as $$
  select p.omraade_id from profiles p
   where p.omraade_id is not null and p.base_lat is not null and p.rolle = 'foto' and la is not null
   order by km_mellem(la, lo, p.base_lat, p.base_lon) limit 1
$$;
revoke execute on function omraade_for(double precision, double precision) from public, anon;

create or replace function saet_omraade() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.lat is distinct from old.lat or new.lon is distinct from old.lon then
    new.omraade_id := omraade_for(new.lat, new.lon);
  end if;
  return new;
end $$;
revoke execute on function saet_omraade() from public, anon, authenticated;
-- Navnet starter med "a", så det kører før de andre BEFORE-udløsere
drop trigger if exists a_saet_omraade on haendelser;
create trigger a_saet_omraade before insert or update of lat, lon on haendelser for each row execute function saet_omraade();

-- Åbne hændelser får område nu
update haendelser set omraade_id = omraade_for(lat, lon) where status in ('ny', 'taget', 'ankommet') and lat is not null;

create or replace function tilbud_naeste(h uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare hh haendelser; ind indstillinger; f record; t uuid; n int; tom boolean;
begin
  select * into hh from haendelser where id = h;
  select * into ind from indstillinger where id = 1;
  if hh.id is null or hh.status <> 'ny' or hh.lat is null then return false; end if;
  -- Har området slet ingen fotografer, må alle få tilbuddet
  tom := hh.omraade_id is null or not exists (select 1 from profiles where rolle = 'foto' and omraade_id = hh.omraade_id);
  select p.id, km_mellem(hh.lat, hh.lon, q.la, q.lo) as d, q.base, (p.omraade_id is distinct from hh.omraade_id and p.omraade_id is not null) as nabo into f
    from profiles p
    cross join lateral (select
        case when p.lat is not null and p.pos_tid > now() - make_interval(mins => ind.pos_max_min) then p.lat else p.base_lat end as la,
        case when p.lat is not null and p.pos_tid > now() - make_interval(mins => ind.pos_max_min) then p.lon else p.base_lon end as lo,
        not (p.lat is not null and p.pos_tid > now() - make_interval(mins => ind.pos_max_min)) as base) q
   where p.rolle = 'foto' and p.status = 'ledig' and p.haendelse_id is null and q.la is not null
     and not exists (select 1 from tilbud x where x.haendelse_id = h and x.fotograf = p.id)
     and km_mellem(hh.lat, hh.lon, q.la, q.lo) <= ind.max_km
     and (tom or p.omraade_id is null or p.omraade_id = hh.omraade_id or hh.prio = 1)
   order by case when hh.omraade_id is not null and p.omraade_id = hh.omraade_id then 0 when p.omraade_id is null then 1 else 2 end,
            floor(km_mellem(hh.lat, hh.lon, q.la, q.lo) / 2),
            (select max(x.taget_tid) from haendelser x where x.taget_af = p.id) asc nulls first,
            km_mellem(hh.lat, hh.lon, q.la, q.lo)
   limit 1;
  if f.id is null then return false; end if;
  select coalesce(max(nr), 0) + 1 into n from tilbud where haendelse_id = h;
  insert into tilbud (haendelse_id, fotograf, nr, afstand_km, udloeber)
  values (h, f.id, n, f.d, now() + make_interval(secs => ind.tilbud_sek)) returning id into t;
  insert into logbog (bruger, haendelse_id, handling)
  values (null, h, format('tilbød opgaven til %s (%s km%s%s)', (select navn from profiles where id = f.id), round(f.d::numeric, 1),
    case when f.base then ' fra udgangspunkt' else '' end, case when f.nabo and not tom then ', nabo-område – høj prioritet' else '' end));
  perform net.http_post(
    url := 'https://RET_MIG_PROJEKT.supabase.co/functions/v1/push',
    body := jsonb_build_object('tilbud', t),
    headers := jsonb_build_object('Content-Type', 'application/json'));
  return true;
end $$;
revoke execute on function tilbud_naeste(uuid) from public, anon, authenticated;

-- Høj prioritet på en hændelse, som området ikke har taget: start tilbud igen – nu også til naboerne
create or replace function prio_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.prio is distinct from old.prio then
    insert into logbog (bruger, haendelse_id, handling)
      values (auth.uid(), new.id, 'satte prioritet til ' || case new.prio when 1 then 'høj' when 3 then 'lav' else 'normal' end);
    if new.prio = 1 and new.status = 'ny' and new.tilbud_status = 'ingen_svar' and new.lat is not null then
      update haendelser set tilbud_status = 'afventer', tilbud_start = now() where id = new.id;
      if not tilbud_naeste(new.id) then
        update haendelser set tilbud_status = 'ingen_svar' where id = new.id;
      end if;
    end if;
  end if;
  return null;
end $$;
revoke execute on function prio_log() from public, anon, authenticated;
