-- Henter nye Pushover-beskeder hvert 15. sekund.
-- Kør EFTER opsaetning.sql, og efter at funktionen "pushover" er lagt op.
-- Ret de to steder, der står RET_MIG:
--   PROJEKT  = dit projekts adresse, fx abcdefgh.supabase.co (Project Settings -> API)
--   HEMMELIG = samme tekst som hemmeligheden FOTOVAGT_SECRET under Edge Functions -> Secrets

create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.unschedule('hent-pushover') where exists (select 1 from cron.job where jobname = 'hent-pushover');
select cron.schedule('hent-pushover', '15 seconds', $$
  select net.http_post(
    url := 'https://RET_MIG_PROJEKT.supabase.co/functions/v1/pushover',
    body := '{"hent": true}'::jsonb,
    headers := '{"Content-Type": "application/json", "x-fotovagt-secret": "RET_MIG_HEMMELIG"}'::jsonb,
    timeout_milliseconds := 30000
  );
$$);

-- Ryd op i pg_net's svarlog hver nat, så databasen ikke vokser
select cron.unschedule('ryd-net-svar') where exists (select 1 from cron.job where jobname = 'ryd-net-svar');
select cron.schedule('ryd-net-svar', '17 3 * * *', $$ delete from net._http_response where created < now() - interval '1 day' $$);

-- Fotografer, der ikke har haft appen åben i 2 timer, sættes til "offline" (hvis de ikke har en opgave)
select cron.unschedule('offline-fotografer') where exists (select 1 from cron.job where jobname = 'offline-fotografer');
select cron.schedule('offline-fotografer', '*/10 * * * *', $$
  update public.profiles set status = 'offline', status_tid = now()
   where status <> 'offline' and haendelse_id is null
     and coalesce(sidst_set, status_tid) < now() - interval '2 hours'
$$);
