-- Opgradering: kommer der en mere alvorlig melding på en hændelse (fx "Eftersyn" -> "Bygn.brand"),
-- får hændelsen den nye titel og kategori (se alvor() i parse.js), og opgraderet sættes.
-- Så sendes push: til ledige fotografer, hvis ingen har taget den, ellers til fotografen på opgaven.
-- Kør i Supabase -> SQL Editor efter push.sql. Ret RET_MIG_PROJEKT til projektets adresse.
alter table haendelser add column if not exists opgraderet timestamptz;
alter table haendelser add column if not exists push_opgraderet timestamptz;

create or replace function push_kald() returns trigger
language plpgsql security definer set search_path = public as $$
declare slags text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'ny' then slags := 'ny'; end if;
  elsif new.taget_af is distinct from old.taget_af and new.taget_af is not null
        and new.taget_af is distinct from auth.uid() then
    slags := 'tildelt';
  elsif new.opgraderet is distinct from old.opgraderet and new.opgraderet is not null then
    slags := 'opgraderet';
  elsif new.tekst is distinct from old.tekst and new.taget_af is not null then
    slags := 'opdatering';
  end if;
  if slags is not null then
    perform net.http_post(
      url := 'https://RET_MIG_PROJEKT.supabase.co/functions/v1/push',
      body := jsonb_build_object('id', new.id, 'slags', slags),
      headers := jsonb_build_object('Content-Type', 'application/json'));
  end if;
  return new;
end $$;
drop trigger if exists push_kald on haendelser;
create trigger push_kald after insert or update of status, taget_af, tekst, opgraderet on haendelser
  for each row execute function push_kald();
