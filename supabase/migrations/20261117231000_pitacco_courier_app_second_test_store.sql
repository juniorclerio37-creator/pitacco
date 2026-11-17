-- Secure courier-side support for one expressly authorized second store.
-- The original account remains at Açaí do Linho; the test link is the only exception.
create or replace function public.pitacco_driver_allowed_stores()
returns table(store_id uuid,store_name text)
language plpgsql stable security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or not public.pitacco_courier_session_ready() then
  raise exception 'Sessão do entregador não autorizada' using errcode='42501';
 end if;
 return query
 select s.id,s.name
 from public.couriers c
 join public.stores s on s.id=c.store_id or public.pitacco_courier_test_access(c.id,s.id)
 where c.user_id=(select auth.uid()) and c.active
 order by case when s.id=c.store_id then 0 else 1 end,s.name;
end;
$$;
revoke all on function public.pitacco_driver_allowed_stores() from public,anon;
grant execute on function public.pitacco_driver_allowed_stores() to authenticated;

-- Extend the ALREADY AUTHENTICATED driver functions, keeping all original
-- session, active-courier, state, code and marketplace checks unchanged.
-- If a function is not present in the stripped-down CI fixture, do not create
-- a mock production implementation. The actual production functions are tested
-- below by verifying the exact matching source fragments after deployment.
do $test_store_courier$
declare p record;
        v_oid oid;
        v_sql text;
begin
 for p in
  select * from (values
   ('pitacco_driver_card_badges()',
    'c.id=d.courier_id and c.store_id=d.store_id',
    'c.id=d.courier_id and (c.store_id=d.store_id or public.pitacco_courier_test_access(c.id,d.store_id))'),
   ('pitacco_driver_order_detail(uuid)',
    'c.id = d.courier_id and c.store_id = d.store_id',
    'c.id = d.courier_id and (c.store_id = d.store_id or public.pitacco_courier_test_access(c.id,d.store_id))'),
   ('pitacco_driver_history(integer)',
    'c.id=d.courier_id and c.store_id=d.store_id',
    'c.id=d.courier_id and (c.store_id=d.store_id or public.pitacco_courier_test_access(c.id,d.store_id))'),
   ('pitacco_driver_arrive(uuid)',
    'c.id=src.courier_id and c.store_id=src.store_id',
    'c.id=src.courier_id and (c.store_id=src.store_id or public.pitacco_courier_test_access(c.id,src.store_id))'),
   ('pitacco_driver_ifood_action(uuid,text)',
    'c.id=src.courier_id and c.store_id=src.store_id',
    'c.id=src.courier_id and (c.store_id=src.store_id or public.pitacco_courier_test_access(c.id,src.store_id))'),
   ('pitacco_driver_verify_own_code(uuid,text)',
    'c.id=src.courier_id and c.store_id=src.store_id',
    'c.id=src.courier_id and (c.store_id=src.store_id or public.pitacco_courier_test_access(c.id,src.store_id))'),
   ('pitacco_driver_depart(uuid)',
    'c.user_id = (select auth.uid()) and c.store_id = b.store_id',
    'c.user_id = (select auth.uid()) and (c.store_id = b.store_id or public.pitacco_courier_test_access(c.id,b.store_id))'),
   ('pitacco_claim_courier_push()',
    'c.id=d.courier_id and c.store_id=d.store_id',
    'c.id=d.courier_id and (c.store_id=d.store_id or public.pitacco_courier_test_access(c.id,d.store_id))'),
   ('pitacco_driver_earnings(text)',
    'and d.store_id = v_store',
    'and (d.store_id = v_store or public.pitacco_courier_test_access(v_courier,d.store_id))')
  ) as entries(signature,needle,replacement)
 loop
  v_oid:=pg_catalog.to_regprocedure('public.'||p.signature);
  if v_oid is null then
   raise notice 'CI fixture: missing %, skipping.',p.signature;
   continue;
  end if;
  v_sql:=pg_catalog.pg_get_functiondef(v_oid);
  if pg_catalog.strpos(v_sql,p.needle)=0 then
   raise exception 'Unable to safely extend driver function %: unexpected implementation',p.signature;
  end if;
  execute pg_catalog.replace(v_sql,p.needle,p.replacement);
 end loop;
end;
$test_store_courier$;

notify pgrst, 'reload schema';
