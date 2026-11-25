
alter table pitacco_private.ifood_central_requests add column if not exists last_checked_at timestamptz;
create table if not exists pitacco_private.ifood_central_check_ticket(
 singleton boolean primary key default true check(singleton),
 ticket uuid not null, expires_at timestamptz not null
);
alter table pitacco_private.ifood_central_check_ticket enable row level security;
revoke all on pitacco_private.ifood_central_check_ticket from public,anon,authenticated;
create or replace function public.pitacco_ifood_central_check_claim(p_ticket uuid)
returns table(id uuid,merchant_id uuid,reviewed_by uuid)
language plpgsql security definer set search_path='' as $$
begin
 delete from pitacco_private.ifood_central_check_ticket t where t.ticket=p_ticket and t.expires_at>now();
 if not found then return; end if;
 if not coalesce((select merchant_linking from pitacco_private.ifood_control),false) then return; end if;
 return query with batch as (
  select r.id from pitacco_private.ifood_central_requests r
  where r.state='awaiting' and r.reviewed_by is not null
    and exists(select 1 from pitacco_private.platform_owner o where o.user_id=r.reviewed_by)
    and (r.last_checked_at is null or r.last_checked_at<now()-interval '55 seconds')
  order by r.last_checked_at nulls first,r.created_at limit 5 for update skip locked
 ) update pitacco_private.ifood_central_requests r set last_checked_at=now()
 from batch where r.id=batch.id returning r.id,r.merchant_id,r.reviewed_by;
end $$;
revoke all on function public.pitacco_ifood_central_check_claim(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_central_check_claim(uuid) to service_role;
