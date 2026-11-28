-- Fotovagt 15.40: udsigten de næste 6 timer fra DMI's prognosemodel HARMONIE (opendataapi.dmi.dk, åbne data).
-- Bruges i risikovurderingen under "Kan udvikle sig" (fx vindstød, der tager til, eller frost med nedbør senere).
-- Gemmes i haendelser.vejr.udsigt og bevares, når met.no/DMI-målingen opdaterer vejret.
create table if not exists vejr_udsigt_koe (
  haendelse_id uuid primary key references haendelser(id) on delete cascade,
  req_id bigint, sendt timestamptz not null default now(), forsoeg int not null default 1
);
alter table vejr_udsigt_koe enable row level security;

-- Udsigten må ikke forsvinde, når de andre kilder skriver vejret
do $do$ declare def text; begin
  def := pg_get_functiondef('public.vejr_saml()'::regprocedure);
  if position('udsigt' in def) = 0 then
    def := replace(def, $a$vejr->'obs')
         where id = k.haendelse_id;$a$, $a$vejr->'obs') || jsonb_strip_nulls(jsonb_build_object('udsigt', vejr->'udsigt'))
         where id = k.haendelse_id;$a$);
    execute def;
  end if;
  def := pg_get_functiondef('public.vejr_obs_saml()'::regprocedure);
  if position('udsigt' in def) = 0 then
    def := replace(def, $a$'{}'::jsonb)), o) where id = k.haendelse_id;$a$,
                        $a$'{}'::jsonb)), o) || jsonb_strip_nulls(jsonb_build_object('udsigt', vejr->'udsigt')) where id = k.haendelse_id;$a$);
    execute def;
  end if;
end $do$;

create or replace function vejr_udsigt_bestil() returns int
language plpgsql security definer set search_path = public as $$
declare h record; n int := 0;
begin
  delete from vejr_udsigt_koe where sendt < now() - interval '3 hours';
  for h in
    select x.id, x.lat, x.lon, k.forsoeg from haendelser x left join vejr_udsigt_koe k on k.haendelse_id = x.id
     where x.lat is not null and (x.vejr is null or x.vejr->'udsigt' is null) and x.oprettet > now() - interval '2 hours'
       and (k.haendelse_id is null or (k.sendt < now() - interval '5 minutes' and k.forsoeg < 3))
     order by x.oprettet desc limit 10
  loop
    insert into vejr_udsigt_koe (haendelse_id, req_id, forsoeg)
    values (h.id, net.http_get(
        format('https://opendataapi.dmi.dk/v1/forecastedr/collections/harmonie_dini_sf/position?coords=POINT(%s%%20%s)&parameter-name=wind-speed,gust-wind-speed-10m,temperature-2m,total-precipitation&crs=crs84',
          round(h.lon::numeric, 3), round(h.lat::numeric, 3)), timeout_milliseconds := 20000), coalesce(h.forsoeg, 0) + 1)
    on conflict (haendelse_id) do update set req_id = excluded.req_id, sendt = now(), forsoeg = vejr_udsigt_koe.forsoeg + 1;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function vejr_udsigt_saml() returns int
language plpgsql security definer set search_path = public as $$
declare k record; j jsonb; u jsonb; n int := 0;
begin
  for k in select q.haendelse_id, r.status_code, r.content from vejr_udsigt_koe q join net._http_response r on r.id = q.req_id loop
    if k.status_code = 200 then
      begin
        j := k.content::jsonb;
        with t as (
          select (tid)::timestamptz tid, i - 1 i from jsonb_array_elements_text(j->'domain'->'axes'->'t'->'values') with ordinality a(tid, i)
        ), v as (
          select t.tid,
            (j->'ranges'->'gust-wind-speed-10m'->'values'->>t.i::int)::numeric stoed,
            (j->'ranges'->'wind-speed'->'values'->>t.i::int)::numeric vind,
            (j->'ranges'->'temperature-2m'->'values'->>t.i::int)::numeric - 273.15 temp,
            (j->'ranges'->'total-precipitation'->'values'->>t.i::int)::numeric regn
          from t where t.tid between date_trunc('hour', now()) and now() + interval '6 hours'
        )
        select jsonb_strip_nulls(jsonb_build_object(
          'stoed_max_3t', (select round(max(stoed), 1) from v where tid <= now() + interval '3 hours'),
          'stoed_max_6t', round(max(stoed), 1),
          'vind_max_6t', round(max(vind), 1),
          'stoed_tid', (select tid from v order by stoed desc nulls last limit 1),
          'temp_min_6t', round(min(temp), 1),
          'nedboer_6t', round(sum(regn), 1),
          'kilde', 'DMI HARMONIE', 'beregnet', now())) into u from v;
        if u ? 'stoed_max_6t' then
          update haendelser set vejr = coalesce(vejr, '{}') || jsonb_build_object('udsigt', u) where id = k.haendelse_id;
          n := n + 1;
          delete from vejr_udsigt_koe where haendelse_id = k.haendelse_id;
        else
          update vejr_udsigt_koe set req_id = null, forsoeg = 3 where haendelse_id = k.haendelse_id;
        end if;
      exception when others then
        update vejr_udsigt_koe set req_id = null, forsoeg = forsoeg + 1 where haendelse_id = k.haendelse_id;
      end;
    elsif k.status_code is not null then
      update vejr_udsigt_koe set sendt = now() - interval '4 minutes' where haendelse_id = k.haendelse_id;
    end if;
  end loop;
  return n;
end $$;

revoke execute on function vejr_udsigt_bestil(), vejr_udsigt_saml() from public, anon, authenticated;
select cron.unschedule(jobname) from cron.job where jobname = 'fotovagt-vejr-udsigt';
select cron.schedule('fotovagt-vejr-udsigt', '* * * * *', $$select vejr_udsigt_saml(); select vejr_udsigt_bestil();$$);

-- DR's vejr-feed i nyheds-dashboardet, og vejrfare tæller som 112-stof
insert into nyhedsfeeds (navn, url) values ('DR Vejret', 'https://www.dr.dk/nyheder/service/feeds/vejret') on conflict (url) do nothing;
