-- Synthetic fixtures only. Never execute against the real Pitacco database.
create role pitacco_core_app login password 'ci-app-only' nosuperuser nocreatedb nocreaterole nobypassrls;
create role pitacco_core_menu login password 'ci-menu-only' nosuperuser nocreatedb nocreaterole nobypassrls;
create schema fixture_private;
revoke all on schema fixture_private from public;
create table fixture_private.menus(slug text primary key,payload jsonb not null);
insert into fixture_private.menus values
('loja-a','{"store":{"slug":"loja-a","name":"Loja A"},"products":[{"name":"Açaí A","price":20}]}'),
('loja-b','{"store":{"slug":"loja-b","name":"Loja B"},"products":[{"name":"Açaí B","price":25}]}');
create function public.get_public_menu(p_slug text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  select payload into result from fixture_private.menus where slug=p_slug;
  if not found then raise exception 'Cardapio indisponivel'; end if;
  return result;
end $$;
revoke all on function public.get_public_menu(text) from public;
grant execute on function public.get_public_menu(text) to pitacco_core_menu;
