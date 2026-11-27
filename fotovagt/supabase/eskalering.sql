-- Stor hændelse: kaldes der assistance mere end 3 gange OG er der mere end 4 enheder på hændelsen,
-- foreslås en opgradering til kontoret (push + ⚠️ på hændelsen). Kontoret afgør, om den skal
-- opgraderes på fotografernes skærm (manuel opgradering). Grænserne står i indstillinger.
-- Enheder tælles ud fra beredskabets koder i alle meldinger: SY-M1, SY V1, OD S1, VB V-1, KO MR-1,
-- ISL NO (indsatsleder) og OC (operationschef).
-- Kør i Supabase -> SQL Editor efter tilbud.sql og opgradering.sql. Ret RET_MIG_PROJEKT.

alter table indstillinger add column if not exists eskaler_ass int not null default 3;        -- flere end 3 assistancer
alter table indstillinger add column if not exists eskaler_enheder int not null default 4;    -- flere end 4 enheder
alter table indstillinger add column if not exists eskaler_begge boolean not null default true; -- true: begge skal opfyldes

alter table haendelser add column if not exists antal_ass int not null default 0;
alter table haendelser add column if not exists antal_enheder int not null default 0;
alter table haendelser add column if not exists eskalering_forslag timestamptz;   -- foreslået til kontoret
alter table haendelser add column if not exists eskaleret boolean not null default false;   -- kontoret har opgraderet
alter table haendelser add column if not exists eskalering_afvist boolean not null default false;
alter table haendelser add column if not exists push_eskalering timestamptz;

-- Tæl assistancer (meldinger med "Ass." eller "assistance") og forskellige enheder i hele teksten
create or replace function tael_enheder(t text) returns int
language sql immutable set search_path = public as $$
  select count(distinct regexp_replace(upper(m[1]), '[\s-]', '', 'g'))::int
    from regexp_matches(coalesce(t, ''), '\m([A-ZÆØÅ]{2,3}[\s-]?(?:MR|[MVSRBTKH])[\s-]?\d{1,2}|ISL\s+[A-ZÆØÅ]{2,3}|OC)\M', 'g') as m;
$$;
create or replace function tael_ass(t text) returns int
language sql immutable set search_path = public as $$
  select count(*)::int from unnest(string_to_array(coalesce(t, ''), E'\n')) l where l ~* '(\mass\.|assistance)';
$$;

create or replace function eskalering_tjek() returns trigger
language plpgsql security definer set search_path = public as $$
declare ind indstillinger; ok_ass boolean; ok_enh boolean;
begin
  new.antal_ass := tael_ass(new.tekst);
  new.antal_enheder := tael_enheder(new.tekst);
  if new.eskalering_forslag is null and not new.eskaleret and not new.eskalering_afvist
     and new.status in ('ny', 'taget', 'ankommet') then
    select * into ind from indstillinger where id = 1;
    ok_ass := new.antal_ass > coalesce(ind.eskaler_ass, 3);
    ok_enh := new.antal_enheder > coalesce(ind.eskaler_enheder, 4);
    if (coalesce(ind.eskaler_begge, true) and ok_ass and ok_enh) or (not coalesce(ind.eskaler_begge, true) and (ok_ass or ok_enh)) then
      new.eskalering_forslag := now();
    end if;
  end if;
  return new;
end $$;
drop trigger if exists eskalering_tjek on haendelser;
create trigger eskalering_tjek before insert or update of tekst on haendelser for each row execute function eskalering_tjek();

-- Push: forslag -> kontoret
create or replace function eskalering_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.eskalering_forslag is not null and (tg_op = 'INSERT' or old.eskalering_forslag is null) then
    perform net.http_post(
      url := 'https://RET_MIG_PROJEKT.supabase.co/functions/v1/push',
      body := jsonb_build_object('id', new.id, 'slags', 'eskalering'),
      headers := jsonb_build_object('Content-Type', 'application/json'));
  end if;
  return new;
end $$;
drop trigger if exists eskalering_push on haendelser;
create trigger eskalering_push after insert or update of eskalering_forslag on haendelser for each row execute function eskalering_push();

-- Kontoret afgør: opgradér (fotograferne får besked via "opgraderet") eller afvis
create or replace function eskaler(h uuid, ja boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not er_kontor() then raise exception 'Kun kontoret kan opgradere hændelser.'; end if;
  if ja then
    update haendelser set eskaleret = true, eskalering_afvist = false, opgraderet = now(),
           eskalering_forslag = coalesce(eskalering_forslag, now()) where id = h;
    perform skriv_log(h, 'opgraderede hændelsen til stor hændelse');
  else
    update haendelser set eskalering_afvist = true where id = h;
    perform skriv_log(h, 'afviste opgradering');
  end if;
end $$;
revoke execute on function eskaler(uuid, boolean), eskalering_tjek(), eskalering_push() from public, anon;
grant execute on function eskaler(uuid, boolean) to authenticated;
revoke execute on function eskalering_tjek(), eskalering_push() from authenticated;

-- Tæl op på de aktive hændelser (uden at foreslå noget for gamle)
update haendelser set antal_ass = tael_ass(tekst), antal_enheder = tael_enheder(tekst) where status in ('ny', 'taget', 'ankommet');
