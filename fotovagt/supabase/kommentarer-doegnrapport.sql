-- Kommentarer på hændelser + offentlig døgnrapport (til hrc-fotos.dk).
-- Kør i Supabase -> SQL Editor efter de andre filer. Ret RET_MIG_PROJEKT til projektets adresse.
--
-- Kommentarer:   fotografer og kontoret skriver løbende på en hændelse. Hver kommentar er enten
--                intern (kun i Fotovagt) eller offentlig (vises på døgnrapporten).
-- Døgnrapport:   funktionen doegnrapport(dag) må kaldes af alle (også uden login). Den giver kun
--                kategori, område (by/postnummer, aldrig vej og husnummer), en afrundet placering
--                og de offentlige kommentarer, uden navne.

-- Kommentarer -------------------------------------------------------------------------------
create table if not exists kommentarer (
  id uuid primary key default gen_random_uuid(),
  haendelse_id uuid not null references haendelser on delete cascade,
  bruger uuid references profiles on delete set null,
  tekst text not null check (char_length(tekst) between 1 and 2000),
  offentlig boolean not null default false,
  oprettet timestamptz not null default now(),
  push_sendt boolean not null default false
);
create index if not exists kommentarer_haendelse on kommentarer (haendelse_id, oprettet);
alter table kommentarer enable row level security;
drop policy if exists "laes" on kommentarer;
create policy "laes" on kommentarer for select to authenticated using (er_bruger());

create or replace function kommenter(h uuid, tekst text, offentlig boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare k uuid; t text := trim(tekst);
begin
  if not er_bruger() then raise exception 'Du er ikke logget ind.'; end if;
  if t = '' then raise exception 'Skriv en kommentar.'; end if;
  if not exists (select 1 from haendelser where id = h) then raise exception 'Hændelsen findes ikke.'; end if;
  insert into kommentarer (haendelse_id, bruger, tekst, offentlig) values (h, auth.uid(), left(t, 2000), coalesce(offentlig, false))
    returning id into k;
  perform skriv_log(h, 'skrev en ' || case when offentlig then 'offentlig' else 'intern' end || ' kommentar');
  return k;
end $$;

-- Skift mellem intern/offentlig eller slet: den, der skrev den, eller kontoret
create or replace function ret_kommentar(k uuid, offentlig boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update kommentarer set offentlig = ret_kommentar.offentlig
   where id = k and (bruger = auth.uid() or er_kontor());
  if not found then raise exception 'Du kan kun ændre dine egne kommentarer.'; end if;
end $$;
create or replace function slet_kommentar(k uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from kommentarer where id = k and (bruger = auth.uid() or er_kontor());
  if not found then raise exception 'Du kan kun slette dine egne kommentarer.'; end if;
end $$;
revoke execute on function kommenter(uuid, text, boolean), ret_kommentar(uuid, boolean), slet_kommentar(uuid) from public, anon;
grant execute on function kommenter(uuid, text, boolean), ret_kommentar(uuid, boolean), slet_kommentar(uuid) to authenticated;

-- Push til fotografen på opgaven, når en anden skriver en kommentar
create or replace function kommentar_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://RET_MIG_PROJEKT.supabase.co/functions/v1/push',
    body := jsonb_build_object('kommentar', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json'));
  return new;
end $$;
drop trigger if exists kommentar_push on kommentarer;
create trigger kommentar_push after insert on kommentarer for each row execute function kommentar_push();
revoke execute on function kommentar_push() from public, anon, authenticated;

do $$ begin
  begin alter publication supabase_realtime add table kommentarer; exception when duplicate_object then null; end;
end $$;

-- Hændelsen på døgnrapporten ----------------------------------------------------------------
alter table haendelser add column if not exists offentlig boolean not null default true;   -- vis på døgnrapporten
alter table haendelser add column if not exists offentlig_titel text;                      -- valgfri overskrift fra kontoret
alter table haendelser add column if not exists omraade text;                              -- fx "Mønsted, 8800 Viborg"

-- Området findes ved et omvendt opslag hos OpenStreetMap (landsby/bydel + postnummer)
create table if not exists omraade_koe (
  haendelse_id uuid primary key references haendelser on delete cascade,
  request_id bigint,
  oprettet timestamptz default now()
);
alter table omraade_koe enable row level security;

create or replace function omraade_bestil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.lat is not null and (tg_op = 'INSERT' or new.lat is distinct from old.lat or new.lon is distinct from old.lon) then
    insert into omraade_koe (haendelse_id) values (new.id)
    on conflict (haendelse_id) do update set request_id = null, oprettet = now();
  end if;
  return new;
end $$;
drop trigger if exists omraade_bestil on haendelser;
create trigger omraade_bestil after insert or update of lat, lon on haendelser for each row execute function omraade_bestil();

-- "Hvidevej 1, Mønsted, 8800 Viborg" -> "Mønsted, 8800 Viborg". Vej og husnummer fjernes altid.
create or replace function offentlig_adresse(a text) returns text
language sql immutable set search_path = public as $$
  select nullif(string_agg(trim(del), ', ' order by nr), '')
    from unnest(string_to_array(coalesce(a, ''), ',')) with ordinality as x(del, nr)
   where trim(del) <> ''
     and (trim(del) ~ '^\d{4}\s' or trim(del) !~ '\d')
     and (trim(del) ~* 'motorvej' or trim(del) !~* '(vej|gade|allé|alle|stræde|torv|plads|boulevard|vænget|parken|stien|vangen|have|bakken|toften)$');
$$;

create or replace function omraade_behandl() returns void
language plpgsql security definer set search_path = public, net as $$
declare r record; svar record; j jsonb; a jsonb; h record; lokal text; pn text; pby text; nye int := 0; res text;
begin
  for r in select * from omraade_koe order by oprettet loop
    if r.request_id is null then
      if nye >= 1 then continue; end if;
      select lat, lon into h from haendelser where id = r.haendelse_id;
      if h.lat is null then delete from omraade_koe where haendelse_id = r.haendelse_id; continue; end if;
      update omraade_koe set request_id = net.http_get(
        url := 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&addressdetails=1&accept-language=da&lat='
               || h.lat || '&lon=' || h.lon,
        headers := jsonb_build_object('User-Agent', 'Fotovagt/1.0 (supabase database)')
      ) where haendelse_id = r.haendelse_id;
      nye := nye + 1;
      continue;
    end if;
    select * into svar from net._http_response where id = r.request_id;
    if not found then continue; end if;
    res := null;
    if svar.status_code = 200 then
      begin j := svar.content::jsonb; exception when others then j := null; end;
      a := j->'address';
      if a is not null then
        select adresse into h from haendelser where id = r.haendelse_id;
        pn := coalesce(substring(h.adresse from '\m(\d{4})\s+[^,]+$'), substring(a->>'postcode' from '\d{4}'));
        pby := coalesce(substring(h.adresse from '\m\d{4}\s+([^,]+)$'), a->>'town', a->>'city', regexp_replace(a->>'municipality', '\s*Kommune$', ''));
        lokal := coalesce(a->>'village', a->>'hamlet', a->>'suburb', a->>'neighbourhood', a->>'town', a->>'city');
        res := concat_ws(', ',
          case when lokal is not null and lower(lokal) <> lower(coalesce(pby, '')) then lokal end,
          nullif(trim(concat_ws(' ', pn, pby)), ''));
      end if;
    end if;
    if res is not null and res <> '' then update haendelser set omraade = res where id = r.haendelse_id; end if;
    delete from omraade_koe where haendelse_id = r.haendelse_id;
  end loop;
  delete from omraade_koe where oprettet < now() - interval '1 hour';
end $$;
revoke execute on function omraade_bestil(), omraade_behandl() from public, anon, authenticated;

select cron.unschedule('omraade') where exists (select 1 from cron.job where jobname = 'omraade');
select cron.schedule('omraade', '5 seconds', $$ select public.omraade_behandl() $$);

-- Døgnrapporten (offentlig) -----------------------------------------------------------------
create or replace function doegnrapport(dag date default null) returns jsonb
language sql stable security definer set search_path = public as $$
  with d as (select coalesce(dag, (now() at time zone 'Europe/Copenhagen')::date) as dag)
  select jsonb_build_object(
    'dag', (select dag from d),
    'opdateret', now(),
    'haendelser', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', left(md5(h.id::text), 12),
        'tid', h.oprettet,
        'kategori', coalesce(h.kategori, 'Andet'),
        'ikon', case when h.titel ~* 'helikopter' then 'helikopter'
                     when h.titel ~* '^\s*(ISL\M|indsatsleder)' then 'isl' end,
        'overskrift', coalesce(nullif(trim(h.offentlig_titel), ''),
          case coalesce(h.kategori, 'Andet') when 'Andet' then 'Hændelse' else h.kategori end),
        'sted', coalesce(h.omraade, offentlig_adresse(h.adresse)),
        'lat', round(h.lat::numeric, 2),
        'lon', round(h.lon::numeric, 2),
        'status', case when h.status in ('afsluttet') then 'afsluttet' else 'aktiv' end,
        'paa_stedet', h.status = 'ankommet' or (h.status = 'afsluttet' and h.ankommet_tid is not null),
        'kommentarer', coalesce((
          select jsonb_agg(jsonb_build_object('tid', k.oprettet, 'tekst', k.tekst) order by k.oprettet)
            from kommentarer k where k.haendelse_id = h.id and k.offentlig), '[]'::jsonb)
      ) order by h.oprettet desc)
      from haendelser h, d
      where (h.oprettet at time zone 'Europe/Copenhagen')::date = d.dag
        and h.offentlig and h.status <> 'annulleret'
    ), '[]'::jsonb));
$$;
revoke execute on function doegnrapport(date) from public;
grant execute on function doegnrapport(date) to anon, authenticated;
