-- The published storefront logo is the canonical store identity.
-- Fresh test installations must contain the same store media column as production.
alter table public.stores add column if not exists logo_path text;
create or replace function pitacco_private.published_store_logo_path(p_store uuid)
returns text language sql stable set search_path='' as $$
 select coalesce(
 case when d.published->>'logo_path' ~ ('^stores/'||s.id::text||'/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$') then d.published->>'logo_path' end,
 case when s.logo_path ~ ('^stores/'||s.id::text||'/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$') then s.logo_path end)
 from public.stores s left join public.pitacco_storefront_designs d on d.store_id=s.id where s.id=p_store;
$$;
revoke all on function pitacco_private.published_store_logo_path(uuid) from public,anon,authenticated;
create or replace function pitacco_private.sync_published_store_logo() returns trigger
language plpgsql security definer set search_path='' as $$
declare path text:=new.published->>'logo_path';
begin
 if path ~ ('^stores/'||new.store_id::text||'/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$') then
 update public.stores set logo_path=path where id=new.store_id and logo_path is distinct from path;
 end if;
 return new;
end $$;
revoke all on function pitacco_private.sync_published_store_logo() from public,anon,authenticated;
drop trigger if exists pitacco_sync_published_store_logo on public.pitacco_storefront_designs;
create trigger pitacco_sync_published_store_logo after insert or update of published on public.pitacco_storefront_designs
for each row execute function pitacco_private.sync_published_store_logo();
update public.stores s set logo_path=d.published->>'logo_path'
from public.pitacco_storefront_designs d where d.store_id=s.id
and d.published->>'logo_path' ~ ('^stores/'||s.id::text||'/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$')
and s.logo_path is distinct from d.published->>'logo_path';
-- Only authenticated members of the current store can retrieve this identity.
create or replace function public.pitacco_store_identity(p_store uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('store_id',s.id,'logo_path',pitacco_private.published_store_logo_path(s.id),
 'legacy_logo_url',case when b.logo_url ~ '^https://' then b.logo_url end)
 from public.stores s left join public.store_customer_branding b on b.store_id=s.id
 where s.id=p_store and auth.uid() is not null and public.can_access_store(s.id);
$$;
revoke all on function public.pitacco_store_identity(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_store_identity(uuid) to authenticated;
-- Tracking already verifies the unguessable order token; expose only that store's published media path.
do $migration$
declare def text:=pg_get_functiondef('public.pitacco_track_public_order(uuid)'::regprocedure);
 anchor constant text:=$a$'logo_url',b.logo_url,$a$;
begin
 if strpos(def,anchor)=0 then raise exception 'Tracking identity anchor missing';end if;
 execute replace(def,anchor,anchor||$a$'logo_path',pitacco_private.published_store_logo_path(s.id),$a$);
end $migration$;
notify pgrst,'reload schema';
