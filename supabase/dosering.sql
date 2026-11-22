-- 2026-11-22: doseringen fra FMK gemmes i sit eget felt, præcis som FMK skriver den.
-- Appen viser den i påmindelser og regner eller ændrer den aldrig.
alter table meds add column if not exists dosering text;
