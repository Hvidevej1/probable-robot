-- Sikkerhedslukning (Fotovagt 11.05). Kør i Supabase -> SQL Editor efter de øvrige filer.

-- 1) Interne kald til Edge Function "push" sender hemmeligheden med (push afviser kald uden den)
create or replace function intern_headers() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('Content-Type', 'application/json', 'x-fotovagt-secret', (select cron_secret from intern where id = 1)) $$;
revoke execute on function intern_headers() from public, anon, authenticated;
do $$ declare f text; d text; begin
  foreach f in array array['eskalering_push', 'kommentar_push', 'push_kald', 'sos_push', 'tilbud_naeste'] loop
    select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = f and p.prokind = 'f' limit 1;
    if d ~ 'jsonb_build_object\(''Content-Type'', ''application/json''\)' then
      execute replace(d, 'jsonb_build_object(''Content-Type'', ''application/json'')', 'intern_headers()');
    end if;
  end loop;
end $$;

-- 2) Faste search_path på hjælpefunktioner
alter function enhed_type(text) set search_path = public;
alter function sted_noegle(haendelser) set search_path = public;
alter function grund_alvor(text) set search_path = public;
alter function region_fra_postnr(int) set search_path = public;
alter function sted_norm(text) set search_path = public;
alter function hviler(haendelser) set search_path = public;

-- 3) Interne hjælpefunktioner kan ikke kaldes udefra
revoke execute on function region_id(text) from public, anon, authenticated;
revoke execute on function omraade_for(double precision, double precision) from public, anon, authenticated;

-- 4) Profilbilleder: kun rene JPEG-data (intet, der kan bryde ud af HTML)
delete from profilfoto where foto !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$';
alter table profilfoto drop constraint if exists profilfoto_foto_check;
alter table profilfoto add constraint profilfoto_foto_check
  check (foto ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' and length(foto) < 150000);

-- 5) Links på hændelser: kun http(s) (et "javascript:"-link fjernes)
create or replace function sikker_url() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.url is not null and new.url !~* '^https?://' then new.url := null; end if;
  return new;
end $$;
revoke execute on function sikker_url() from public, anon, authenticated;
drop trigger if exists a_sikker_url on haendelser;
create trigger a_sikker_url before insert or update of url on haendelser for each row execute function sikker_url();
