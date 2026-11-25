create or replace function public.pitacco_admin_send_courier_campaign(
 p_request uuid,p_audience text,p_store uuid,p_courier uuid,p_title text,p_body text
) returns jsonb
language plpgsql volatile security definer set search_path to ''
as $$
declare
 v_id uuid;
 v_owner uuid := (select auth.uid());
 v_targets integer;
 v_jobs integer;
begin
 if v_owner is null or not public.pitacco_is_platform_owner() then
  raise exception 'Somente o Super Admin pode enviar comunicados' using errcode='42501';
 end if;
 if p_request is null or p_audience not in ('all','store','courier')
    or (p_audience='all' and (p_store is not null or p_courier is not null))
    or (p_audience='store' and (p_store is null or p_courier is not null))
    or (p_audience='courier' and (p_courier is null or p_store is not null)) then
  raise exception 'Destinatários inválidos' using errcode='22023';
 end if;
 if p_title is null or length(btrim(p_title)) not between 1 and 80
    or p_body is null or length(btrim(p_body)) not between 1 and 400
    or p_title ~ '[[:cntrl:]]' or p_body ~ '[[:cntrl:]]' then
  raise exception 'Informe título de até 80 e mensagem de até 400 caracteres, sem caracteres de controle'
   using errcode='22023';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('courier_admin_send:'||v_owner::text||':'||p_request::text,0));
 select id into v_id from pitacco_private.courier_admin_campaigns
 where created_by=v_owner and request_id=p_request;
 if v_id is null then
  insert into pitacco_private.courier_admin_campaigns
   (request_id,created_by,audience,store_id,courier_id,title,body)
  values(p_request,v_owner,p_audience,p_store,p_courier,btrim(p_title),btrim(p_body))
  returning id into v_id;
  insert into pitacco_private.courier_admin_recipients(campaign_id,courier_id)
  select v_id,c.id from public.couriers c
  where c.active and c.user_id is not null
    and (p_audience='all'
         or (p_audience='store' and c.store_id=p_store)
         or (p_audience='courier' and c.id=p_courier));
  insert into pitacco_private.courier_admin_push_jobs
   (campaign_id,courier_id,token)
  select v_id,r.courier_id,d.token
  from pitacco_private.courier_admin_recipients r
  join public.couriers c on c.id=r.courier_id and c.active
  join pitacco_private.courier_push_device d on d.courier_id=c.id
     and d.push_protocol='data_only' and d.expires_at>now()
  join auth.sessions sess on sess.id=d.session_id and sess.user_id=c.user_id
  join auth.users usr on usr.id=c.user_id
    and (usr.banned_until is null or usr.banned_until<=now())
  where r.campaign_id=v_id
  on conflict do nothing;
  -- Global/individual campaigns have no store_id in the campaign itself.
  -- Preserve the store-scoped audit invariant and record only affected stores.
  -- The private campaign row remains the authoritative global audit/history.
  insert into public.operation_audit(store_id,actor,action,details)
  select affected.store_id,v_owner,'admin_courier_campaign_created',
   jsonb_build_object('campaign_id',v_id,'audience',p_audience,
    'title',btrim(p_title))
  from (
   select p_store as store_id where p_audience='store'
   union
   select c.store_id from public.couriers c
   join pitacco_private.courier_admin_recipients r on r.courier_id=c.id
   where r.campaign_id=v_id and p_audience in ('all','courier')
  ) affected where affected.store_id is not null;
 end if;
 select count(*) into v_targets from pitacco_private.courier_admin_recipients
 where campaign_id=v_id;
 select count(*) into v_jobs from pitacco_private.courier_admin_push_jobs
 where campaign_id=v_id;
 return jsonb_build_object('campaign_id',v_id,
  'targeted_couriers',v_targets,'queued_devices',v_jobs,
  'silent',true,'already_exists',
    (select created_at<now()-interval '5 seconds'
     from pitacco_private.courier_admin_campaigns where id=v_id));
end $$;
revoke all on function public.pitacco_admin_send_courier_campaign(uuid,text,uuid,uuid,text,text)
 from public,anon;
grant execute on function public.pitacco_admin_send_courier_campaign(uuid,text,uuid,uuid,text,text)
 to authenticated;

