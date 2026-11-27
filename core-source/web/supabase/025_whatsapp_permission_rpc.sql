-- Explicit, limited authorization RPC for Edge Function user context.
begin;
create or replace function public.pitacco_can_manage_store(p_store_id uuid)
returns boolean language sql stable security invoker set search_path=''
as $$select coalesce(public.is_store_manager(p_store_id),false)$$;
revoke all on function public.pitacco_can_manage_store(uuid) from public,anon;
grant execute on function public.pitacco_can_manage_store(uuid) to authenticated;
commit;
