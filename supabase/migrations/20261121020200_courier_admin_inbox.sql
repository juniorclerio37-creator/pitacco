-- Authenticated courier reads ONLY campaigns specifically addressed to them.
-- This persists incentives when the Android system notification is dismissed.
create or replace function public.pitacco_courier_admin_inbox()
returns table(campaign_id uuid,title text,body text,created_at timestamptz)
language plpgsql stable security definer set search_path to ''
as $$
begin
 if (select auth.uid()) is null or
    not public.pitacco_courier_session_ready() then
   raise exception 'Sessão do entregador não autorizada' using errcode='42501';
 end if;
 return query
 select a.id,a.title,a.body,a.created_at
 from pitacco_private.courier_admin_campaigns a
 join pitacco_private.courier_admin_recipients r on r.campaign_id=a.id
 join public.couriers c on c.id=r.courier_id
 where c.user_id=(select auth.uid()) and c.active
 order by a.created_at desc limit 40;
end $$;
revoke all on function public.pitacco_courier_admin_inbox() from public,anon;
grant execute on function public.pitacco_courier_admin_inbox() to authenticated;