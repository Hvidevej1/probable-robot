-- ISL-forespørgsel starter som lav prioritet. Kaldes der assistance bagefter, hæves den til normal.
-- Derefter gælder de øvrige regler (eskalering ved mange assistancer/enheder, kritiske ord, kontorets valg).
-- Pushover-funktionen lægger assistancen ind i forespørgslen (samme station, eller samme beredskab højst 20 km væk,
-- inden for 2 timer). Assistenten (ai_indsigt) foreslår det samme. Kør i Supabase -> SQL Editor.
create or replace function isl_prio() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.titel ~* 'forespørgsel' and coalesce(new.prio, 2) = 2 then new.prio := 3; end if;
  elsif old.prio = 3 and new.prio = 3
        and (split_part(coalesce(old.tekst, ''), E'\n', 1) ~* 'forespørgsel' or old.titel ~* 'forespørgsel')
        and tael_ass(new.tekst) > tael_ass(old.tekst) then
    new.prio := 2;
    insert into logbog (bruger, haendelse_id, handling)
      values (null, new.id, 'assistance kaldt efter ISL-forespørgsel – prioritet hævet fra lav til normal');
  end if;
  return new;
end $$;
revoke execute on function isl_prio() from public, anon, authenticated;
drop trigger if exists b_isl_prio on haendelser;
create trigger b_isl_prio before insert or update of tekst on haendelser for each row execute function isl_prio();

-- Assistenten: lav uden assistance, normal med assistance
do $$ declare d text; begin
  d := pg_get_functiondef('public.ai_indsigt(uuid)'::regprocedure);
  if d ~ 'ISL-forespørgsel med assistance' then return; end if;
  d := replace(d, $x$  alvor := case when forslag = 1 then 'stor' when forslag = 3 then 'lille' else 'normal' end;$x$,
$x$  -- ISL-forespørgsel: lav, indtil der kaldes assistance – så normal (og derefter de øvrige regler)
  if (split_part(coalesce(hh.tekst, ''), E'\n', 1) ~* 'forespørgsel' or hh.titel ~* 'forespørgsel') then
    if tael_ass(hh.tekst) > 0 and forslag = 3 then
      forslag := 2; grund := grund || 'ISL-forespørgsel med assistance – hævet fra lav til normal'::text;
    elsif tael_ass(hh.tekst) = 0 and forslag = 2 then
      forslag := 3; grund := grund || 'ISL-forespørgsel uden assistance – lav'::text;
    end if;
  end if;
  alvor := case when forslag = 1 then 'stor' when forslag = 3 then 'lille' else 'normal' end;$x$);
  execute d;
end $$;
