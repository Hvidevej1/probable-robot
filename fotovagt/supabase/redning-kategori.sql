-- Redningskoder fra beredskabet ("Redn.-Silo/Brønd" m.fl.) skal have redningsikonet, ikke brand.
-- Beredskabets beskeder har altid 🔥, så parseren kunne tidligere sætte dem som Brand.
create or replace function public.redning_kategori() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.kategori is distinct from 'Redning'
     and new.titel ~* '(\mredn\.|\mredning\M|\msilo\M|brønd|drukn|person i vand|fastklemt|dyreredning|vandredning)'
     and new.titel !~* 'brand & redning' then
    new.kategori := 'Redning';
  end if;
  return new;
end $$;

drop trigger if exists redning_kategori on public.haendelser;
create trigger redning_kategori before insert or update of titel on public.haendelser
  for each row execute function public.redning_kategori();
