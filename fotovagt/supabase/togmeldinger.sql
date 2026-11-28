-- Togmeldinger (DSB, Banedanmark, Arriva, letbane …), Fotovagt 11.06.
-- * Overskrift fra beskeden: "Tog: Forventet forsinkelse på IC 5757 – Tinglev St. → Flensburg"
-- * Lav prioritet og "hvilende" (ingen tilbud, intet blink), medmindre teksten tyder på noget alvorligt:
--   påkørsel, ulykke, afsporing, brand, røg, evakuering, sammenstød, eksplosion, bombe eller politiets arbejde.
-- * Kommer der senere en alvorlig melding, hæves den til normal, og det normale forløb starter.
-- * Assistenten sammenligner togmeldinger med togmeldinger (type 'tog').
-- Kør i Supabase -> SQL Editor efter tabt-gods.sql.
create or replace function er_tog(titel text, tekst text) returns boolean language sql immutable set search_path = public as $$
  select coalesce(titel, '') ~* '^tog:' or coalesce(titel, '') || ' ' || coalesce(tekst, '') ~* '(\m(dsb|banedanmark|arriva|letbane|s-tog|regionaltog|lyntog|intercity|ic ?\d{3,4}|re ?\d{3,4})\M|\(tog\))' $$;
create or replace function tog_alvorlig(tekst text) returns boolean language sql immutable set search_path = public as $$
  select coalesce(tekst, '') ~* '(påkør|personulykke|ulykke|afspor|brand|røgudvikling|\mrøg\M|evakuer|sammenstød|kollision|eksplosion|bombe|politi)' $$;

create or replace function tog_titel() returns trigger
language plpgsql set search_path = public as $$
declare l text; ov text; rute text;
begin
  if new.titel ~* '^trafikmelding\M' and er_tog(new.titel, new.tekst) then
    l := btrim(split_part(coalesce(new.tekst, ''), E'\n', 1));
    ov := coalesce((regexp_match(l, '^(.{12,90}?)\s+(?:Vi|Det|Der|Vores|Toget|Togene|Pga\.?|På grund|Årsagen)\s'))[1], left(l, 80));
    rute := replace(coalesce(new.adresse, ''), '->', '→');
    new.titel := 'Tog: ' || left(ov, 70) || case when rute <> '' then ' – ' || rute else '' end;
  end if;
  return new;
end $$;
drop trigger if exists a0_tog_titel on haendelser;
create trigger a0_tog_titel before insert on haendelser for each row execute function tog_titel();

create or replace function hviler(h haendelser) returns boolean language sql immutable set search_path = public as $$
  select coalesce(h.prio, 2) = 3 and (coalesce(h.titel, '') ~* 'tabt gods' or (er_tog(h.titel, h.tekst) and not tog_alvorlig(h.tekst))) $$;

create or replace function isl_prio() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if (new.titel ~* 'forespørgsel' or new.titel ~* 'tabt gods' or (er_tog(new.titel, new.tekst) and not tog_alvorlig(new.tekst)))
       and coalesce(new.prio, 2) = 2 then new.prio := 3; end if;
  elsif old.prio = 3 and new.prio = 3 then
    if (split_part(coalesce(old.tekst, ''), E'\n', 1) ~* 'forespørgsel' or old.titel ~* 'forespørgsel')
       and tael_ass(new.tekst) > tael_ass(old.tekst) then
      new.prio := 2;
      insert into logbog (bruger, haendelse_id, handling)
        values (null, new.id, 'assistance kaldt efter ISL-forespørgsel – prioritet hævet fra lav til normal');
    elsif old.titel ~* 'tabt gods' and (tael_ass(new.tekst) > tael_ass(old.tekst) or coalesce(new.titel, '') !~* 'tabt gods') then
      new.prio := 2;
      insert into logbog (bruger, haendelse_id, handling)
        values (null, new.id, 'tabt gods har udviklet sig (' || case when tael_ass(new.tekst) > tael_ass(old.tekst) then 'assistance kaldt' else 'ny melding: ' || coalesce(new.titel, '') end || ') – prioritet hævet til normal');
    elsif er_tog(old.titel, old.tekst) and not tog_alvorlig(old.tekst) and tog_alvorlig(new.tekst) then
      new.prio := 2;
      insert into logbog (bruger, haendelse_id, handling)
        values (null, new.id, 'togmelding har udviklet sig (' || coalesce((regexp_match(new.tekst, '(påkør\w*|personulykke|ulykke|afspor\w*|brand|røg\w*|evakuer\w*|sammenstød|kollision|eksplosion|bombe|politi\w*)', 'i'))[1], 'alvorlig melding') || ') – prioritet hævet til normal');
    end if;
  end if;
  return new;
end $$;

create or replace function vaagn() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.prio = 3 and new.prio < 3 and (coalesce(old.titel, '') ~* 'tabt gods' or er_tog(old.titel, old.tekst)) and new.status = 'ny' and new.tilbud_status is null
     and new.lat is not null and not coalesce(new.cirka, false)
     and (select auto_tilbud and not (coalesce(new.kategori, '') = any(kategorier_fra)) from indstillinger where id = 1) then
    update haendelser set tilbud_status = 'afventer', tilbud_start = now() where id = new.id and tilbud_status is null;
    if not tilbud_naeste(new.id) then
      update haendelser set tilbud_status = 'ingen_svar' where id = new.id;
    end if;
  end if;
  return null;
end $$;
revoke execute on function isl_prio(), vaagn(), tog_titel() from public, anon, authenticated;

do $$ declare d text; begin
  d := pg_get_functiondef('public.type_noegle(text)'::regprocedure);
  if d !~ '''tog''' then
    d := replace(d, $x$    when t ~ '^(aba|automatisk brandalarm)' then 'aba'$x$,
      $x$    when coalesce(titel, '') ~* '(^tog:|\m(dsb|banedanmark|arriva|letbane|s-tog|regionaltog|lyntog|intercity)\M|\(tog\)|\mic ?\d{3,4}\M)' then 'tog'
    when t ~ '^(aba|automatisk brandalarm)' then 'aba'$x$);
    execute d;
  end if;
end $$;
