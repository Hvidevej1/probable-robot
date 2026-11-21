-- Automatisk opdatering af receptpriser fra medicinpriser.dk.
-- Kør efter opsaetning.sql, og når funktionen "opdater-priser" er lagt op.
alter table meds add column if not exists varenr text;            -- varenummer fra FMK
alter table meds add column if not exists tilskudspris numeric;   -- "Tilskud beregnes af"
alter table meds add column if not exists pris_opdateret date;    -- hvornår prisen sidst blev hentet
alter table meds add column if not exists billigst_navn text;     -- billigste kopiprodukt med samme pakning
alter table meds add column if not exists billigst_varenr text;
alter table meds add column if not exists billigst_pris numeric;

create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('opdater-priser') where exists (select 1 from cron.job where jobname = 'opdater-priser');
-- Hver morgen kl. 6 (dansk vintertid = 5 UTC). Priserne skifter hver anden mandag.
select cron.schedule('opdater-priser', '0 5 * * *', $$
  select net.http_post(
    url := 'https://andmqexhvvidvebsosgw.supabase.co/functions/v1/opdater-priser',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);
