-- Push-beskeder til fotografernes telefoner (også når telefonen er låst).
-- Kør EFTER opsaetning.sql, og efter at funktionen "push" er lagt op.
-- Ret RET_MIG_PROJEKT til dit projekts adresse (Project Settings -> API), fx abcdefgh.supabase.co
--
-- Hvornår der sendes:
--   ny hændelse          -> alle fotografer, der står som "Ledig"
--   kontoret tildeler    -> den fotograf, der får opgaven
--   live opdatering      -> den fotograf, der har taget opgaven (ny tekst lagt ind fra en anden kilde)

create extension if not exists pg_net;

-- Telefoner, der vil have push. Kun funktionerne herunder og Edge Function rører tabellen.
create table if not exists push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  user_id uuid not null references profiles on delete cascade,
  created timestamptz default now()
);
alter table push_subscriptions enable row level security;

create or replace function gem_push(ep text, nøgle text, hemmelig text) returns void
language sql security definer set search_path = public as $$
  insert into push_subscriptions (endpoint, p256dh, auth, user_id) values (ep, nøgle, hemmelig, auth.uid())
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, user_id = auth.uid(), created = now();
$$;
create or replace function slet_push(ep text) returns void
language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = ep and user_id = auth.uid();
$$;
revoke execute on function gem_push(text, text, text), slet_push(text) from public, anon;
grant execute on function gem_push(text, text, text), slet_push(text) to authenticated;

-- Hvad der allerede er sendt, så samme besked aldrig sendes to gange
alter table haendelser add column if not exists push_ny boolean default false;
alter table haendelser add column if not exists push_tekst_len int;
alter table haendelser add column if not exists push_tildelt uuid;

create or replace function push_start() returns trigger
language plpgsql as $$
begin
  new.push_tekst_len := coalesce(length(new.tekst), 0);
  return new;
end $$;
drop trigger if exists push_start on haendelser;
create trigger push_start before insert on haendelser for each row execute function push_start();

-- Databasen kalder funktionen "push" med hændelsens id. Funktionen slår selv hændelsen op og
-- sender kun, hvis der faktisk er sket noget nyt. Et kald udefra kan derfor ikke sende falske beskeder.
create or replace function push_kald() returns trigger
language plpgsql security definer set search_path = public as $$
declare slags text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'ny' then slags := 'ny'; end if;
  elsif new.taget_af is distinct from old.taget_af and new.taget_af is not null
        and new.taget_af is distinct from auth.uid() then
    slags := 'tildelt';                        -- kontoret har givet opgaven til en fotograf
  elsif new.tekst is distinct from old.tekst and new.taget_af is not null then
    slags := 'opdatering';
  end if;
  if slags is not null then
    perform net.http_post(
      url := 'https://RET_MIG_PROJEKT.supabase.co/functions/v1/push',
      body := jsonb_build_object('id', new.id, 'slags', slags),
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  end if;
  return new;
end $$;
drop trigger if exists push_kald on haendelser;
create trigger push_kald after insert or update of status, taget_af, tekst on haendelser
  for each row execute function push_kald();

-- SOS: ny alarm -> kontoret + fotografer inden for 20 km; "Set" -> besked til den, der trykkede SOS
create or replace function sos_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare slags text;
begin
  if tg_op = 'INSERT' then slags := 'sos';
  elsif old.kvitteret_af is null and new.kvitteret_af is not null then slags := 'sos_set';
  end if;
  if slags is not null then
    perform net.http_post(
      url := 'https://RET_MIG_PROJEKT.supabase.co/functions/v1/push',
      body := jsonb_build_object('sos', new.id, 'slags', slags),
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  end if;
  return new;
end $$;
drop trigger if exists sos_push on sos;
create trigger sos_push after insert or update of kvitteret_af on sos for each row execute function sos_push();
revoke execute on function sos_push() from public, anon, authenticated;
