-- Admin courier communications (silent, signed by the platform owner only).
-- This is independent of store assignment notifications and their loud sound.
create table if not exists pitacco_private.courier_admin_campaigns (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null,
 created_by uuid not null references auth.users(id),
 audience text not null check(audience in ('all','store','courier')),
 store_id uuid references public.stores(id),
 courier_id uuid references public.couriers(id),
 title text not null check(length(btrim(title)) between 1 and 80),
 body text not null check(length(btrim(body)) between 1 and 400),
 created_at timestamptz not null default now(),
 unique(created_by,request_id),
 check((audience='all' and store_id is null and courier_id is null)
   or (audience='store' and store_id is not null and courier_id is null)
   or (audience='courier' and courier_id is not null and store_id is null))
);
create table if not exists pitacco_private.courier_admin_recipients (
 campaign_id uuid not null references pitacco_private.courier_admin_campaigns(id) on delete cascade,
 courier_id uuid not null references public.couriers(id),
 primary key(campaign_id,courier_id)
);
create table if not exists pitacco_private.courier_admin_push_jobs (
 event_id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references pitacco_private.courier_admin_campaigns(id) on delete cascade,
 courier_id uuid not null references public.couriers(id),
 token text not null,
 expires_at timestamptz not null default now()+interval '24 hours',
 available_at timestamptz not null default now(),
 attempts integer not null default 0,
 status text not null default 'pending' check(status in ('pending','sent','invalid','rejected')),
 sent_at timestamptz,
 unique(campaign_id,courier_id,token)
);
create index if not exists courier_admin_jobs_ready_idx
 on pitacco_private.courier_admin_push_jobs(available_at)
 where status='pending' and sent_at is null;
create index if not exists courier_admin_campaigns_recent_idx
 on pitacco_private.courier_admin_campaigns(created_at desc);

revoke all on pitacco_private.courier_admin_campaigns from public,anon,authenticated;
revoke all on pitacco_private.courier_admin_recipients from public,anon,authenticated;
revoke all on pitacco_private.courier_admin_push_jobs from public,anon,authenticated;

create or replace function public.pitacco_admin_courier_audience()
returns table(id uuid,name text,store_id uuid,store_name text,active boolean,registered_devices bigint)
language plpgsql stable security definer set search_path to ''
as $$
begin
 if not public.pitacco_is_platform_owner() then
  raise exception 'Acesso exclusivo do Super Admin' using errcode='42501';
 end if;
 return query
 select c.id,c.name,c.store_id,s.name,c.active,
  (select count(*) from pitacco_private.courier_push_device d
   where d.courier_id=c.id and d.push_protocol='data_only'
    and d.expires_at>now() and exists(
     select 1 from auth.sessions sess where sess.id=d.session_id and sess.user_id=c.user_id
    ))::bigint
 from public.couriers c
 join public.stores s on s.id=c.store_id
 order by s.name,c.name,c.id;
end $$;
revoke all on function public.pitacco_admin_courier_audience() from public,anon;
grant execute on function public.pitacco_admin_courier_audience() to authenticated;

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
  insert into public.operation_audit(store_id,actor,action,details)
  values(p_store,v_owner,'admin_courier_campaign_created',
   jsonb_build_object('campaign_id',v_id,'audience',p_audience,
    'title',btrim(p_title)));
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

create or replace function public.pitacco_admin_courier_campaign_history()
returns table(id uuid,created_at timestamptz,audience text,store_id uuid,courier_id uuid,
 title text,body text,targeted_couriers bigint,queued_devices bigint,sent_devices bigint)
language plpgsql stable security definer set search_path to ''
as $$
begin
 if not public.pitacco_is_platform_owner() then
  raise exception 'Acesso exclusivo do Super Admin' using errcode='42501';
 end if;
 return query
 select a.id,a.created_at,a.audience,a.store_id,a.courier_id,a.title,a.body,
  (select count(*) from pitacco_private.courier_admin_recipients r where r.campaign_id=a.id),
  (select count(*) from pitacco_private.courier_admin_push_jobs j where j.campaign_id=a.id),
  (select count(*) from pitacco_private.courier_admin_push_jobs j
   where j.campaign_id=a.id and j.status='sent')
 from pitacco_private.courier_admin_campaigns a
 order by a.created_at desc limit 50;
end $$;
revoke all on function public.pitacco_admin_courier_campaign_history() from public,anon;
grant execute on function public.pitacco_admin_courier_campaign_history() to authenticated;

create or replace function public.pitacco_claim_admin_courier_push()
returns table(event_id uuid,token text,title text,body text)
language plpgsql volatile security definer set search_path to ''
as $$
begin
 if not exists(select 1 from pitacco_private.courier_push_settings s where s.enabled) then return; end if;
 return query
 with ready as (
  select j.event_id
  from pitacco_private.courier_admin_push_jobs j
  join public.couriers c on c.id=j.courier_id and c.active
  join pitacco_private.courier_push_device d on d.courier_id=c.id
    and d.token=j.token and d.push_protocol='data_only' and d.expires_at>now()
  join auth.sessions sess on sess.id=d.session_id and sess.user_id=c.user_id
  join auth.users usr on usr.id=c.user_id and
    (usr.banned_until is null or usr.banned_until<=now())
  where j.status='pending' and j.sent_at is null and j.expires_at>now()
    and j.available_at<=now() and j.attempts<3
  order by j.available_at,j.event_id limit 15
  for update of j skip locked
 ), claimed as (
  update pitacco_private.courier_admin_push_jobs job
  set available_at=now()+interval '30 seconds',attempts=job.attempts+1
  from ready where job.event_id=ready.event_id
  returning job.event_id,job.token,job.campaign_id
 )
 select q.event_id,q.token,a.title,a.body
 from claimed q
 join pitacco_private.courier_admin_campaigns a on a.id=q.campaign_id;
end $$;
revoke all on function public.pitacco_claim_admin_courier_push() from public,anon,authenticated;
grant execute on function public.pitacco_claim_admin_courier_push() to service_role;

create or replace function public.pitacco_finish_admin_courier_push(
 p_event uuid,p_token text,p_result text
) returns void
language plpgsql volatile security definer set search_path to ''
as $$
begin
 if p_result not in ('sent','invalid','rejected','retry') then
  raise exception 'Resultado inválido';
 end if;
 if p_result='invalid' then
  delete from pitacco_private.courier_push_device where token=p_token;
 end if;
 if p_result in ('sent','invalid','rejected') then
  update pitacco_private.courier_admin_push_jobs
  set status=p_result,sent_at=now()
  where event_id=p_event and token=p_token and status='pending';
 end if;
end $$;
revoke all on function public.pitacco_finish_admin_courier_push(uuid,text,text)
 from public,anon,authenticated;
grant execute on function public.pitacco_finish_admin_courier_push(uuid,text,text)
 to service_role;
