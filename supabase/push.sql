-- Push-beskeder: når medicin bliver sat til "skal bestilles" eller "bestilt",
-- kalder databasen funktionen send-push. Kør EFTER opsaetning.sql og efter at
-- funktionen "send-push" er lagt op. Ret projekt-adressen, hvis den er en anden.

create extension if not exists pg_net;

create or replace function notify_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('bestil', 'bestilt')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform net.http_post(
      url := 'https://andmqexhvvidvebsosgw.supabase.co/functions/v1/send-push',
      body := jsonb_build_object('id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  end if;
  return new;
end $$;

drop trigger if exists meds_push on meds;
create trigger meds_push after insert or update on meds
  for each row execute function notify_push();

-- Påmindelse: hver time tjekkes, om noget har stået som "skal afhentes" i 3 dage.
alter table meds add column if not exists reminded timestamptz;  -- sidste påmindelse
create extension if not exists pg_cron;
select cron.unschedule('afhent-paamindelse') where exists (select 1 from cron.job where jobname = 'afhent-paamindelse');
select cron.schedule('afhent-paamindelse', '0 * * * *', $$
  select net.http_post(
    url := 'https://andmqexhvvidvebsosgw.supabase.co/functions/v1/send-push',
    body := '{"remind": true}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
$$);
