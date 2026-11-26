-- Pitacco Control Center. Additive tables only; business contracts and orders remain untouched.
create table pitacco_private.control_admins(user_id uuid primary key references auth.users(id),role text not null check(role in ('observer','support','finance','operations')),modules text[] not null,active boolean not null default true,assigned_by uuid not null,updated_at timestamptz not null default now());
create table pitacco_private.control_audit(id bigint generated always as identity primary key,actor uuid not null,action text not null,store_id uuid references public.stores(id),details jsonb not null default '{}',created_at timestamptz not null default now());
create index control_audit_time on pitacco_private.control_audit(created_at desc);
create table pitacco_private.control_costs(id uuid primary key default gen_random_uuid(),category text not null check(category in ('supabase','cloudflare','firebase','operational','other')),description text not null check(length(description) between 3 and 200),amount_cents bigint not null check(amount_cents>0),incurred_on date not null,reference text not null check(length(reference) between 3 and 120),actor uuid not null,created_at timestamptz not null default now(),unique(category,reference));
create index control_costs_day on pitacco_private.control_costs(incurred_on);
create table pitacco_private.control_observations(service text primary key,status text not null check(status in ('operational','unstable','unavailable','not_configured','awaiting_homologation')),observed_at timestamptz not null,expires_at timestamptz not null,source text not null,summary text not null check(length(summary)<=600),check(expires_at>observed_at));
create table pitacco_private.control_notices(id uuid primary key default gen_random_uuid(),audience text not null check(audience in ('merchants','couriers','all')),store_id uuid references public.stores(id),kind text not null check(kind in ('notice','maintenance','update')),title text not null check(length(title) between 3 and 150),body text not null check(length(body) between 5 and 2000),starts_at timestamptz not null,ends_at timestamptz not null,revoked_at timestamptz,created_by uuid not null,created_at timestamptz not null default now(),check(ends_at>starts_at));
create index control_notices_live on pitacco_private.control_notices(starts_at,ends_at) where revoked_at is null;
create table pitacco_private.control_assistance(id uuid primary key default gen_random_uuid(),store_id uuid not null references public.stores(id),requested_by uuid not null,reason text not null check(length(reason) between 10 and 500),requested_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '30 minutes',approved_by uuid,approved_at timestamptz,revoked_at timestamptz);
create index control_assistance_store on pitacco_private.control_assistance(store_id,expires_at desc);
create table pitacco_private.control_lifecycle(id bigint generated always as identity primary key,store_id uuid not null references public.stores(id),event text not null check(event in ('free_to_paid','paid_to_free')),occurred_at timestamptz not null default now());
create table pitacco_private.control_settings(singleton boolean primary key default true check(singleton),measurement_started_at timestamptz not null default now(),support_label text not null default 'Suporte Pitacco',maintenance_note text not null default '');
insert into pitacco_private.control_settings default values;
do $secure$ declare t text;begin foreach t in array array['control_admins','control_audit','control_costs','control_observations','control_notices','control_assistance','control_lifecycle','control_settings'] loop execute format('alter table pitacco_private.%I enable row level security',t);execute format('revoke all on pitacco_private.%I from public,anon,authenticated',t);end loop;end $secure$;
create function pitacco_private.control_require(p_module text,p_write boolean default false) returns void language plpgsql stable set search_path='' as $$
begin
 if auth.uid() is null or not (public.pitacco_is_platform_owner() or exists(select 1 from pitacco_private.control_admins a where a.user_id=auth.uid() and a.active and p_module=any(a.modules))) then raise exception 'Acesso administrativo não autorizado' using errcode='42501';end if;
 if p_write and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception 'Confirme sua autenticação em dois fatores antes desta ação' using errcode='42501';end if;
end $$;
revoke all on function pitacco_private.control_require(text,boolean) from public,anon,authenticated;
create function public.pitacco_control_access() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a pitacco_private.control_admins%rowtype;root boolean:=public.pitacco_is_platform_owner();begin
 if auth.uid() is null then raise exception 'Sessão necessária' using errcode='42501';end if;
 select * into a from pitacco_private.control_admins where user_id=auth.uid() and active;
 return jsonb_build_object('allowed',root or a.user_id is not null,'owner',root,'role',case when root then 'owner' else a.role end,'modules',case when root then array['analytics','stores','users','finance','costs','operations','health','security','communications','assistance','settings','features'] else a.modules end,'aal',coalesce(auth.jwt()->>'aal','aal1'));
end $$;
-- Query-time access checks mean revoked administrators lose access without waiting for JWT refresh.
create function public.pitacco_control_stores(p_search text default '',p_status text default 'all',p_plan text default 'all',p_sort text default 'name',p_page integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; total bigint; q text:=lower(btrim(coalesce(p_search,'')));digits text:=regexp_replace(coalesce(p_search,''),'[^0-9]','','g');begin
 perform pitacco_private.control_require('stores');
 if length(q)>150 or p_page is null or p_page not between 0 and 10000 or p_status not in ('all','active','trial','courtesy','suspended','overdue','legacy','online','offline') or p_sort not in ('name','newest','oldest') then raise exception 'Filtros inválidos' using errcode='22023';end if;
 with candidates as (
 select s.id,s.name,s.created_at,s.city,s.state,s.logo_path,st.status,
 coalesce(c.plan_code,s.plan) as plan,
 exists(select 1 from public.public_menu_settings m where m.store_id=s.id and m.enabled and coalesce((public.pitacco_public_store_open(m.slug)->>'open')::boolean,false)) as online,
 case when r.document_cipher is not null then '••• '||right(pitacco_private.store_registration_document(s.id),4) end as document_masked,
 r.person_type,r.document_cipher is not null as registration_complete,
 (select count(*) from public.store_members m where m.store_id=s.id) as users
 from public.stores s cross join lateral pitacco_private.subscription_state(s.id) st
 left join pitacco_private.store_registration r on r.store_id=s.id
 left join lateral(select cc.plan_code from pitacco_private.commercial_contracts cc where cc.store_id=s.id and cc.effective_from<=(now() at time zone 'America/Sao_Paulo')::date and (cc.valid_from_at is null or cc.valid_from_at<=now()) and (cc.valid_until_at is null or cc.valid_until_at>now()) order by cc.effective_from desc,cc.created_at desc limit 1)c on true
 where q='' or strpos(lower(s.name),q)>0 or s.id::text=q or (length(digits) in (11,14) and pitacco_private.store_registration_document(s.id)=digits)
 ),filtered as(select * from candidates where (p_plan='all' or plan=p_plan) and (p_status='all' or status=p_status or (p_status='online' and online) or (p_status='offline' and not online))),page as(select * from filtered order by case when p_sort='name' then lower(name) end,case when p_sort='newest' then created_at end desc,case when p_sort='oldest' then created_at end,id offset p_page*20 limit 20)
 select (select count(*) from filtered),(select coalesce(jsonb_agg(to_jsonb(page)),'[]') from page) into total,rows;
 return jsonb_build_object('rows',rows,'total',total,'page',p_page,'page_size',20,'observed_at',now());
end $$;
-- Cash receipts are settled invoices; merchant gross sales never enter Pitacco revenue.
create function public.pitacco_control_dashboard(p_start date default current_date-29,p_end date default current_date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;start_at timestamptz;end_at timestamptz;days integer;begin
 perform pitacco_private.control_require('analytics');
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>365 then raise exception 'Selecione um período de até 366 dias' using errcode='22023';end if;
 start_at:=p_start::timestamp at time zone 'America/Sao_Paulo';end_at:=(p_end+1)::timestamp at time zone 'America/Sao_Paulo';days:=p_end-p_start+1;
 with shop as(select s.*,st.status,c.plan_code,c.terms,
 exists(select 1 from public.public_menu_settings m where m.store_id=s.id and m.enabled and coalesce((public.pitacco_public_store_open(m.slug)->>'open')::boolean,false)) as online
 from public.stores s cross join lateral pitacco_private.subscription_state(s.id) st
 left join lateral(select cc.plan_code,cc.terms from pitacco_private.commercial_contracts cc where cc.store_id=s.id and cc.effective_from<=(now() at time zone 'America/Sao_Paulo')::date and (cc.valid_from_at is null or cc.valid_from_at<=now()) and (cc.valid_until_at is null or cc.valid_until_at>now()) order by cc.effective_from desc,cc.created_at desc limit 1)c on true),
 sales as(select * from public.orders where created_at>=start_at-(days*interval '1 day') and created_at<end_at and status<>'historical' and coalesce(receipt->>'is_test','false')<>'true' and coalesce(receipt->>'ifood_test','false')<>'true'),
 cash as(select i.kind,p.amount_cents,p.verified_at from pitacco_private.commercial_manual_payments p join pitacco_private.commercial_invoices i on i.id=p.invoice_id where p.verified_at>=start_at and p.verified_at<end_at),
 receivables as(select i.amount_cents,i.due_at from pitacco_private.commercial_invoices i left join pitacco_private.commercial_manual_payments p on p.invoice_id=i.id where p.invoice_id is null),
 daily as(select d::date as day,(select count(*) from sales o where (o.created_at at time zone 'America/Sao_Paulo')::date=d::date) as orders,(select coalesce(sum(o.gross),0) from sales o where (o.created_at at time zone 'America/Sao_Paulo')::date=d::date and o.preparation_status='completed' and o.status not in ('cancelled','rejected')) as merchant_gross,(select coalesce(sum(c.amount_cents),0)/100.0 from cash c where (c.verified_at at time zone 'America/Sao_Paulo')::date=d::date) as revenue,(select count(*) from public.stores s where (s.created_at at time zone 'America/Sao_Paulo')::date=d::date) as signups from generate_series(p_start::timestamp,p_end::timestamp,interval '1 day')d)
 select jsonb_build_object('observed_at',now(),'period',jsonb_build_object('start',p_start,'end',p_end,'days',days),
 'stores',(select jsonb_build_object('total',count(*),'active',count(*) filter(where status='active'),'online',count(*) filter(where online),'offline',count(*) filter(where not online),'free',count(*) filter(where plan_code='free'),'paying',count(*) filter(where plan_code='complete' and status='active'),'trial',count(*) filter(where status='trial'),'courtesy',count(*) filter(where status='courtesy'),'suspended',count(*) filter(where status='suspended'),'overdue',count(*) filter(where status='overdue'),'new',count(*) filter(where created_at>=start_at and created_at<end_at),'previous_new',count(*) filter(where created_at>=start_at-days*interval '1 day' and created_at<start_at),'mrr',coalesce(sum((terms->>'monthly_cents')::numeric/100) filter(where status='active' and plan_code='complete'),0)) from shop),
 'orders',(select jsonb_build_object('total',count(*) filter(where created_at>=start_at),'previous',count(*) filter(where created_at<start_at),'completed',count(*) filter(where created_at>=start_at and preparation_status='completed' and status not in ('cancelled','rejected')),'cancelled',count(*) filter(where created_at>=start_at and status in ('cancelled','rejected')),'in_progress',count(*) filter(where created_at>=start_at and status in ('pending','accepted') and preparation_status<>'completed'),'gross',coalesce(sum(gross) filter(where created_at>=start_at and preparation_status='completed' and status not in ('cancelled','rejected')),0)) from sales),
 'channels',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select source,count(*) as orders from sales where created_at>=start_at group by source order by count(*) desc)x),
 'couriers',(select jsonb_build_object('total',count(*),'online',count(*) filter(where c.active and c.available and exists(select 1 from public.courier_positions p where p.courier_id=c.id and p.observed_at>now()-interval '5 minutes'))) from public.couriers c),
 'finance',jsonb_build_object('subscriptions',(select coalesce(sum(amount_cents) filter(where kind='monthly'),0)/100.0 from cash),'commissions',(select coalesce(sum(amount_cents) filter(where kind='commission'),0)/100.0 from cash),'revenue',(select coalesce(sum(amount_cents),0)/100.0 from cash),'receivables',(select coalesce(sum(amount_cents),0)/100.0 from receivables),'overdue',(select coalesce(sum(amount_cents) filter(where due_at<now()),0)/100.0 from receivables),'proofs_pending',(select count(*) from pitacco_private.commercial_payment_claims where status='pending'),'costs',(select sum(amount_cents)/100.0 from pitacco_private.control_costs where incurred_on between p_start and p_end),'cost_entries',(select count(*) from pitacco_private.control_costs where incurred_on between p_start and p_end),'reconciliation_pending',(select count(distinct invoice_id) from pitacco_private.asaas_commercial_incidents ai where coalesce(pitacco_private.asaas_current_resolution(ai.invoice_id),'') not in ('funds_confirmed','recovery_paid','waived','manual_only'))),
 'lifecycle',jsonb_build_object('measurement_started_at',(select measurement_started_at from pitacco_private.control_settings where singleton),'conversions',(select count(*) from pitacco_private.control_lifecycle where event='free_to_paid' and occurred_at>=start_at and occurred_at<end_at),'paid_cancellations',(select count(*) from pitacco_private.control_lifecycle where event='paid_to_free' and occurred_at>=start_at and occurred_at<end_at),'rates_available',false),
 'alerts',jsonb_build_object('operational',(select count(*) from public.pitacco_operational_incidents where status='open'),'delivery',(select count(*) from public.pitacco_delivery_incidents where state in ('open','acknowledged')),'support',(select count(*) from public.pitacco_support_tickets where status not in ('closed','resolved'))),
 'series',(select coalesce(jsonb_agg(to_jsonb(daily) order by day),'[]') from daily),
 'sources',jsonb_build_object('sales','orders: concluídos, sem históricos, cancelados ou testes explícitos','revenue','commercial_manual_payments: liquidações Pix manual e Asaas, por verified_at','mrr','contratos mensais vigentes de lojas ativas, sem comissões','online','cardápio habilitado e aberto, sem inferir presença do Windows','costs','despesas cadastradas; ausência não significa custo zero','lifecycle','eventos medidos a partir da implantação, sem reconstruir churn histórico')) into result;
 return result;
end $$;
create table pitacco_private.control_device_versions(store_id uuid not null references public.stores(id),device_id uuid not null,app text not null check(app in ('windows','android')),version text not null check(version ~ '^[0-9]+[.][0-9]+[.][0-9]+$'),seen_at timestamptz not null default now(),primary key(store_id,device_id,app));
alter table pitacco_private.control_device_versions enable row level security;
revoke all on pitacco_private.control_device_versions from public,anon,authenticated;
create function public.pitacco_control_device_ping(p_store uuid,p_device uuid,p_app text,p_version text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or p_device is null or p_app is distinct from 'windows' or not public.pitacco_can_manage_store(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_version is null or p_version !~ '^[0-9]+[.][0-9]+[.][0-9]+$' or length(p_version)>30 then raise exception 'Versão inválida' using errcode='22023';end if;
 insert into pitacco_private.control_device_versions(store_id,device_id,app,version) values(p_store,p_device,p_app,p_version) on conflict(store_id,device_id,app) do update set version=excluded.version,seen_at=now();
end $$;
create function public.pitacco_control_rows(p_view text,p_store uuid default null,p_page integer default 0,p_search text default '') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare items jsonb;scope text;q text:=lower(btrim(coalesce(p_search,'')));begin
 scope:=case p_view when 'delivery_alerts' then 'health' when 'users' then 'users' when 'costs' then 'costs' when 'charges' then 'finance' when 'devices' then 'health' when 'health' then 'health' when 'map' then 'operations' when 'notices' then 'communications' when 'assistance' then 'assistance' when 'audit' then 'security' when 'admins' then 'security' when 'sessions' then 'security' when 'settings' then 'settings' else null end;
 if scope is null or p_page is null or p_page not between 0 and 10000 or length(q)>150 then raise exception 'Consulta inválida' using errcode='22023';end if;
 perform pitacco_private.control_require(scope);
 case p_view
 when 'delivery_alerts' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into items from(select i.id,i.store_id,s.name as store_name,i.kind,i.state,i.created_at,i.resolved_at from public.pitacco_delivery_incidents i join public.stores s on s.id=i.store_id where p_store is null or i.store_id=p_store order by i.created_at desc,i.id offset p_page*25 limit 26)x;
 when 'users' then
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into items from(select p.id,p.full_name as name,p.email,case when p_store is null then p.role else (select m.role from public.store_members m where m.user_id=p.id and m.store_id=p_store) end as role,p.created_at,(select count(*) from public.store_members m where m.user_id=p.id) as stores from public.profiles p where (q='' or strpos(lower(coalesce(p.full_name,'')||' '||p.email),q)>0) and (p_store is null or exists(select 1 from public.store_members m where m.user_id=p.id and m.store_id=p_store)) order by p.created_at desc,p.id offset p_page*25 limit 26)x;
 when 'costs' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into items from(select id,category,description,amount_cents,incurred_on,reference,created_at from pitacco_private.control_costs order by incurred_on desc,id offset p_page*25 limit 26)x;
 when 'charges' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into items from(select i.id,b.store_id,s.name as store_name,i.kind,i.amount_cents,i.due_at,case when p.invoice_id is not null then 'paid' when i.due_at<now() then 'overdue' else 'open' end as status,p.verified_at from pitacco_private.commercial_invoices i join pitacco_private.commercial_closings b using(contract_id,kind,period_end) join public.stores s on s.id=b.store_id left join pitacco_private.commercial_manual_payments p on p.invoice_id=i.id where (p_store is null or s.id=p_store) and (q='' or strpos(lower(s.name),q)>0) order by i.due_at desc,i.id offset p_page*25 limit 26)x;
 when 'devices' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into items from(select w.device_id as id,w.store_id,s.name as store_name,'windows' as app,v.version,w.last_seen_at,w.last_seen_at>now()-interval '90 seconds' as online,'Sinal autenticado; não comprova papel impresso' as evidence from public.pitacco_windows_presence w join public.stores s on s.id=w.store_id left join pitacco_private.control_device_versions v on v.store_id=w.store_id and v.device_id=w.device_id and v.app='windows' where p_store is null or s.id=p_store union all select c.id,c.store_id,s.name,'android',null::text,p.observed_at,c.available and p.observed_at>now()-interval '5 minutes','Posição recebida; versão nativa ainda sem telemetria' from public.couriers c left join public.stores s on s.id=c.store_id join public.courier_positions p on p.courier_id=c.id where p_store is null or c.store_id=p_store order by last_seen_at desc nulls last offset p_page*25 limit 26)x;
 when 'health' then
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into items from(select service as id,case when o.expires_at>now() then o.status else 'no_recent_evidence' end as status,o.observed_at,o.source,o.summary from unnest(array['supabase','cloudflare','database','edge_functions','webhooks','ifood','99food','keeta','asaas','firebase','windows','android','storefront','order_sync','notifications','printing']) service left join pitacco_private.control_observations o using(service) order by service)x;
 when 'map' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into items from(select s.id,'store' as kind,s.name,s.id as store_id,s.latitude,s.longitude,null::timestamptz as observed_at from public.stores s where s.latitude is not null and s.longitude is not null and (p_store is null or s.id=p_store) union all select c.id,'courier',c.name,c.store_id,p.latitude,p.longitude,p.observed_at from public.couriers c join public.courier_positions p on p.courier_id=c.id where c.active and c.available and p.observed_at>now()-interval '5 minutes' and (p_store is null or c.store_id=p_store) order by kind,name offset p_page*100 limit 101)x;
 when 'notices' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into items from(select n.id,n.audience,n.store_id,s.name as store_name,n.kind,n.title,n.body,n.starts_at,n.ends_at,n.revoked_at,n.created_at from pitacco_private.control_notices n left join public.stores s on s.id=n.store_id where p_store is null or n.store_id=p_store order by n.created_at desc offset p_page*25 limit 26)x;
 when 'assistance' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into items from(select a.id,a.store_id,s.name as store_name,a.reason,a.requested_at,a.expires_at,a.approved_at,a.revoked_at,a.requested_by=auth.uid() as own from pitacco_private.control_assistance a join public.stores s on s.id=a.store_id where (p_store is null or a.store_id=p_store) and (public.pitacco_is_platform_owner() or a.requested_by=auth.uid()) order by a.requested_at desc offset p_page*25 limit 26)x;
 when 'audit' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into items from(select a.id,a.actor,a.action,a.store_id,s.name as store_name,a.details,a.created_at from (
 select 'control:'||id::text as id,actor,action,store_id,details,created_at from pitacco_private.control_audit
 union all select 'feature:'||id::text,changed_by,'store_feature',store_id,jsonb_build_object('feature',feature,'enabled',enabled),changed_at from pitacco_private.store_feature_audit
 union all select 'subscription:'||id::text,actor_id,action,store_id,details,created_at from pitacco_private.subscription_admin_audit
 union all select 'operation:'||id::text,actor,action,store_id,details,created_at from public.operation_audit)a left join public.stores s on s.id=a.store_id where (p_store is null or a.store_id=p_store) and (q='' or strpos(lower(a.action),q)>0) order by a.created_at desc,a.id desc offset p_page*25 limit 26)x;
 when 'admins' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into items from(select a.user_id as id,p.email,a.role,a.modules,a.active,a.updated_at from pitacco_private.control_admins a left join public.profiles p on p.id=a.user_id order by a.updated_at desc offset p_page*25 limit 26)x;
 when 'sessions' then
 if to_regclass('auth.sessions') is not null then execute 'select coalesce(jsonb_agg(to_jsonb(x)),''[]'') from (select id,user_id,created_at,updated_at from auth.sessions where user_id in(select user_id from pitacco_private.control_admins where active union select user_id from pitacco_private.platform_owner) order by created_at desc offset $1 limit 26)x' into items using p_page*25;else items:='[]';end if;
 when 'settings' then select jsonb_build_array(jsonb_build_object('id','platform','support_label',support_label,'maintenance_note',maintenance_note,'measurement_started_at',measurement_started_at)) into items from pitacco_private.control_settings where singleton;
 end case;
 return jsonb_build_object('rows',coalesce(items,'[]')-case when p_view='map' then 100 else 25 end,'has_more',jsonb_array_length(coalesce(items,'[]'))>case when p_view='map' then 100 else 25 end,'observed_at',now(),'source','Supabase · registros autorizados');
end $$;
create function public.pitacco_control_mutate(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result uuid;sid uuid;scope text;target uuid;modules text[];n integer;f text;rid uuid;begin
 scope:=case p_action when 'member' then 'users' when 'delivery_incident' then 'health' when 'cost' then 'costs' when 'notice' then 'communications' when 'revoke_notice' then 'communications' when 'assistance' then 'assistance' when 'revoke_assistance' then 'assistance' when 'admin' then 'security' when 'revoke_admin' then 'security' when 'revoke_session' then 'security' when 'settings' then 'settings' when 'features_bulk' then 'features' else null end;
 if scope is null or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Ação inválida' using errcode='22023';end if;
 perform pitacco_private.control_require(scope,true);
 if p_action in ('member','delivery_incident','admin','revoke_admin','revoke_session','settings','features_bulk') and not public.pitacco_is_platform_owner() then raise exception 'Ação exclusiva do proprietário' using errcode='42501';end if;
 sid:=nullif(p_data->>'store_id','')::uuid;
 case p_action
 when 'member' then
  if p_data->>'role' is null or p_data->>'role' not in ('gestor','lojista') then raise exception 'Papel inválido';end if;
  perform 1 from public.stores where id=sid for update;if not found then raise exception 'Loja não encontrada';end if;
  select id into target from auth.users where lower(email)=lower(btrim(p_data->>'email'));if target is null then raise exception 'Conta não encontrada. O usuário deve se cadastrar primeiro.';end if;
  if exists(select 1 from public.store_members where store_id=sid and user_id=target) then perform public.pitacco_owner_set_store_member_role(sid,target,p_data->>'role');else insert into public.store_members(store_id,user_id,role) values(sid,target,p_data->>'role');end if;result:=target;
 when 'delivery_incident' then
  if p_data->>'state' is null or p_data->>'state' not in ('acknowledged','resolved') or length(btrim(coalesce(p_data->>'reason','')))<5 then raise exception 'Estado ou justificativa inválida';end if;
  select store_id into sid from public.pitacco_delivery_incidents where id=(p_data->>'id')::uuid;
  perform public.pitacco_update_delivery_incident((p_data->>'id')::uuid,p_data->>'state');result:=(p_data->>'id')::uuid;
 when 'cost' then insert into pitacco_private.control_costs(category,description,amount_cents,incurred_on,reference,actor) values(p_data->>'category',btrim(p_data->>'description'),(p_data->>'amount_cents')::bigint,(p_data->>'incurred_on')::date,btrim(p_data->>'reference'),auth.uid()) returning id into result;
 when 'notice' then
 if (p_data->>'ends_at')::timestamptz>(p_data->>'starts_at')::timestamptz+interval '90 days' then raise exception 'Comunicados podem durar até 90 dias';end if;
 insert into pitacco_private.control_notices(audience,store_id,kind,title,body,starts_at,ends_at,created_by) values(p_data->>'audience',sid,p_data->>'kind',btrim(p_data->>'title'),btrim(p_data->>'body'),(p_data->>'starts_at')::timestamptz,(p_data->>'ends_at')::timestamptz,auth.uid()) returning id into result;
 when 'revoke_notice' then update pitacco_private.control_notices set revoked_at=now() where id=(p_data->>'id')::uuid and revoked_at is null returning id into result;if not found then raise exception 'Comunicado indisponível';end if;
 when 'assistance' then
 perform 1 from public.stores where id=sid;if not found then raise exception 'Loja não encontrada';end if;
 if exists(select 1 from pitacco_private.control_assistance where store_id=sid and requested_by=auth.uid() and revoked_at is null and expires_at>now()) then raise exception 'Já existe uma solicitação válida para esta loja';end if;
 insert into pitacco_private.control_assistance(store_id,requested_by,reason) values(sid,auth.uid(),p_data->>'reason') returning id into result;
 when 'revoke_assistance' then update pitacco_private.control_assistance set revoked_at=now() where id=(p_data->>'id')::uuid and (requested_by=auth.uid() or public.pitacco_is_platform_owner()) returning id into result;if not found then raise exception 'Solicitação indisponível';end if;
 when 'admin' then
 select id into target from auth.users where lower(email)=lower(btrim(p_data->>'email'));if target is null or exists(select 1 from pitacco_private.platform_owner where user_id=target) then raise exception 'Use uma conta existente diferente do proprietário';end if;
 modules:=case p_data->>'role' when 'observer' then array['analytics','stores','health'] when 'support' then array['analytics','stores','users','health','assistance','communications'] when 'finance' then array['analytics','stores','finance','costs'] when 'operations' then array['analytics','stores','operations','health','communications','assistance'] else null end;
 if modules is null then raise exception 'Perfil inválido';end if;
 insert into pitacco_private.control_admins(user_id,role,modules,assigned_by) values(target,p_data->>'role',modules,auth.uid()) on conflict(user_id) do update set role=excluded.role,modules=excluded.modules,active=true,assigned_by=auth.uid(),updated_at=now();result:=target;
 when 'revoke_admin' then update pitacco_private.control_admins set active=false,updated_at=now() where user_id=(p_data->>'id')::uuid returning user_id into result;if not found then raise exception 'Administrador não encontrado';end if;
 when 'revoke_session' then
 target:=(p_data->>'id')::uuid;
 if target::text=auth.jwt()->>'session_id' then raise exception 'Use Sair para encerrar sua sessão atual';end if;
 if to_regclass('auth.sessions') is null then raise exception 'Sessões indisponíveis';end if;
 execute 'delete from auth.sessions where id=$1 and user_id in (select user_id from pitacco_private.control_admins union select user_id from pitacco_private.platform_owner) returning id' into result using target;
 if result is null then raise exception 'Sessão não encontrada';end if;
 when 'settings' then update pitacco_private.control_settings set support_label=left(btrim(coalesce(p_data->>'support_label','Suporte Pitacco')),100),maintenance_note=left(coalesce(p_data->>'maintenance_note',''),600) where singleton;
 when 'features_bulk' then
 f:=p_data->>'feature';if f is null or f<>all(array['alertas','estoque','cardapio','clientes','fideliza','financeiro','caixa','relatorios','motoboys','integracoes','agendamento']) then raise exception 'Módulo inválido';end if;
 if jsonb_typeof(p_data->'stores')<>'array' or jsonb_array_length(p_data->'stores') not between 1 and 100 or jsonb_typeof(p_data->'enabled')<>'boolean' then raise exception 'Selecione entre 1 e 100 lojas e um estado';end if;
 for sid in select distinct value::uuid from jsonb_array_elements_text(p_data->'stores') loop perform public.pitacco_owner_set_feature(sid,f,(p_data->>'enabled')::boolean);end loop;
 end case;
 insert into pitacco_private.control_audit(actor,action,store_id,details) values(auth.uid(),p_action,sid,jsonb_build_object('id',result,'reason',left(p_data->>'reason',500),'count',case when p_action='features_bulk' then jsonb_array_length(p_data->'stores') end,'feature',p_data->>'feature','role',p_data->>'role'));
 return jsonb_build_object('saved',true,'id',result);
end $$;
-- The merchant explicitly approves/revokes assistance; an admin never impersonates their session.
create function public.pitacco_control_assistance_consent(p_store uuid,p_id uuid default null,p_approve boolean default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare items jsonb;begin
 if auth.uid() is null or not exists(select 1 from public.store_members m where m.store_id=p_store and m.user_id=auth.uid() and m.role='gestor') then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_id is not null then
  if p_approve is null then raise exception 'Informe sua decisão';end if;
  update pitacco_private.control_assistance set approved_by=case when p_approve then auth.uid() else approved_by end,approved_at=case when p_approve then now() else approved_at end,revoked_at=case when not p_approve then now() else revoked_at end where id=p_id and store_id=p_store and expires_at>now() and revoked_at is null and (not p_approve or requested_by<>auth.uid());
  if not found then raise exception 'Solicitação expirada ou revogada';end if;
  insert into pitacco_private.control_audit(actor,action,store_id,details) values(auth.uid(),case when p_approve then 'assistance_approved' else 'assistance_revoked_by_store' end,p_store,jsonb_build_object('id',p_id));
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'reason',reason,'expires_at',expires_at,'approved_at',approved_at) order by requested_at desc),'[]') into items from pitacco_private.control_assistance where store_id=p_store and expires_at>now() and revoked_at is null;
 return jsonb_build_object('rows',items);
end $$;
create function public.pitacco_control_assisted_snapshot(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a pitacco_private.control_assistance%rowtype;result jsonb;begin
 perform pitacco_private.control_require('assistance',true);
 select * into a from pitacco_private.control_assistance where id=p_id and requested_by=auth.uid() and approved_at is not null and revoked_at is null and expires_at>now();
 if not found then raise exception 'Assistência requer autorização válida do lojista' using errcode='42501';end if;
 select jsonb_build_object('store',jsonb_build_object('id',id,'name',name,'address',address,'city',city,'state',state),'orders',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select id,store_id,source,channel,status,preparation_status,gross,fees,created_at,scheduled_release_at,jsonb_build_object('display_number',receipt->>'display_number','external_order_number',receipt->>'external_order_number') as receipt from public.orders where store_id=a.store_id and status<>'historical' and created_at>now()-interval '30 days' order by created_at desc limit 5000)x),'deliveries',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select id,store_id,order_id,status,courier_id,updated_at from public.deliveries where store_id=a.store_id and created_at>now()-interval '30 days' order by created_at desc limit 5000)x),'expenses',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select id,store_id,amount,created_at from public.expenses where store_id=a.store_id and created_at>now()-interval '30 days' order by created_at desc limit 5000)x),'sample_limit',5000,'expires_at',a.expires_at,'mode','read_only') into result from public.stores where id=a.store_id;
 insert into pitacco_private.control_audit(actor,action,store_id,details) values(auth.uid(),'assistance_view',a.store_id,jsonb_build_object('request_id',a.id));return result;
end $$;
create function public.pitacco_control_notices(p_store uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare merchant boolean;courier boolean;items jsonb;begin
 if auth.uid() is null then raise exception 'Sessão necessária' using errcode='42501';end if;
 merchant:=p_store is not null and public.pitacco_can_manage_store(p_store);
 courier:=exists(select 1 from public.couriers c where c.user_id=auth.uid() and c.active and (p_store is null or c.store_id=p_store));
 if not merchant and not courier then return jsonb_build_object('rows','[]'::jsonb);end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'title',n.title,'body',n.body,'kind',n.kind,'ends_at',n.ends_at) order by n.starts_at desc),'[]') into items from (select * from pitacco_private.control_notices where revoked_at is null and starts_at<=now() and ends_at>now() and (store_id is null or store_id=p_store) and (audience='all' or audience='merchants' and merchant or audience='couriers' and courier) order by starts_at desc limit 20)n;
 return jsonb_build_object('rows',items);
end $$;
-- Service-side observations expire: stale evidence must never be shown as green.
create function public.pitacco_control_record_observation(p_service text,p_status text,p_summary text,p_source text,p_ttl integer default 300) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_service<>all(array['supabase','cloudflare','database','edge_functions','webhooks','ifood','99food','keeta','asaas','firebase','windows','android','storefront','order_sync','notifications','printing']) or p_ttl not between 30 and 3600 or length(p_source)>150 then raise exception 'Observação inválida';end if;
 insert into pitacco_private.control_observations(service,status,observed_at,expires_at,source,summary) values(p_service,p_status,now(),now()+p_ttl*interval '1 second',p_source,p_summary) on conflict(service) do update set status=excluded.status,observed_at=excluded.observed_at,expires_at=excluded.expires_at,source=excluded.source,summary=excluded.summary;
end $$;
revoke all on function public.pitacco_control_record_observation(text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.pitacco_control_record_observation(text,text,text,text,integer) to service_role;
-- Lifecycle events only reflect actually effective transitions, not scheduled contract creation.
create function pitacco_private.control_active_session() returns void language plpgsql stable set search_path='' as $$
declare valid boolean;sid uuid:=nullif(auth.jwt()->>'session_id','')::uuid;begin
 if to_regclass('auth.sessions') is not null then
  if sid is null then raise exception 'Sessão administrativa inválida' using errcode='42501';end if;
  execute 'select exists(select 1 from auth.sessions where id=$1 and user_id=$2)' into valid using sid,auth.uid();
  if not valid then raise exception 'Sessão administrativa encerrada' using errcode='42501';end if;
 end if;
end $$;
revoke all on function pitacco_private.control_active_session() from public,anon,authenticated;
-- Insert the session check in the central guard, keeping tests independent of Supabase internals.
do $guard$ declare d text;begin
 select pg_get_functiondef('pitacco_private.control_require(text,boolean)'::regprocedure) into d;
 execute replace(d,'begin','begin perform pitacco_private.control_active_session();');
 select pg_get_functiondef('public.pitacco_control_access()'::regprocedure) into d;
 execute replace(d,'begin','begin perform pitacco_private.control_active_session();');
end $guard$;
do $grants$ declare r record;begin for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'pitacco_control_%' and p.proname<>'pitacco_control_record_observation' loop execute format('revoke all on function %s from public,anon,authenticated',r.signature);execute format('grant execute on function %s to authenticated',r.signature);end loop;end $grants$;
create table pitacco_private.control_plan_features(plan_code text not null check(plan_code in ('free','complete')),feature text not null,enabled boolean not null,updated_at timestamptz not null default now(),primary key(plan_code,feature));
alter table pitacco_private.control_plan_features enable row level security;
revoke all on pitacco_private.control_plan_features from public,anon,authenticated;
create function public.pitacco_control_plan_features(p_plan text,p_feature text default null,p_enabled boolean default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 perform pitacco_private.control_require('features',p_feature is not null);
 if p_plan is null or p_plan not in ('free','complete') then raise exception 'Plano inválido';end if;
 if p_feature is not null then
  if not public.pitacco_is_platform_owner() or not (p_feature=any(pitacco_private.allowed_store_features())) then raise exception 'Sem permissão para esta alteração' using errcode='42501';end if;
  if p_enabled is null then delete from pitacco_private.control_plan_features where plan_code=p_plan and feature=p_feature;else insert into pitacco_private.control_plan_features(plan_code,feature,enabled) values(p_plan,p_feature,p_enabled) on conflict(plan_code,feature) do update set enabled=excluded.enabled,updated_at=now();end if;
  insert into pitacco_private.control_audit(actor,action,details) values(auth.uid(),'plan_feature',jsonb_build_object('plan',p_plan,'feature',p_feature,'enabled',p_enabled));
 end if;
 select coalesce(jsonb_object_agg(feature,enabled),'{}') into result from pitacco_private.control_plan_features where plan_code=p_plan;return result;
end $$;
revoke all on function public.pitacco_control_plan_features(text,text,boolean) from public,anon,authenticated;
grant execute on function public.pitacco_control_plan_features(text,text,boolean) to authenticated;
-- Explicit shop overrides continue to win; default behavior is identical until a plan rule is saved.
do $plan$ declare d text;begin
 select pg_get_functiondef('public.pitacco_store_features(uuid)'::regprocedure) into d;
 if position('coalesce(specific.enabled,platform.enabled,true)' in d)=0 then raise exception 'Feature precedence anchor missing';end if;
 d:=replace(d,'coalesce(specific.enabled,platform.enabled,true)', $r$coalesce(specific.enabled,(select pf.enabled from pitacco_private.control_plan_features pf where pf.feature=features.feature and pf.plan_code=(select c.plan_code from pitacco_private.commercial_contracts c where c.store_id=p_store and c.effective_from<=(now() at time zone 'America/Sao_Paulo')::date and (c.valid_until_at is null or c.valid_until_at>now()) and (c.valid_from_at is null or c.valid_from_at<=now()) order by c.effective_from desc,c.created_at desc limit 1)),platform.enabled,true)$r$);
 execute d;
end $plan$;
-- Enforce second factor and audit at the server, including legacy owner mutation APIs.
do $stepup$ declare r record;d text;pos integer;begin
 for r in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['pitacco_owner_subscription_action','pitacco_owner_set_feature','pitacco_owner_publish_plan_catalog','pitacco_owner_review_manual_proof','pitacco_owner_review_commercial_payment','pitacco_owner_resolve_asaas_incident','pitacco_owner_schedule_commercial_contract','pitacco_owner_set_commercial_billing_control','pitacco_create_release','pitacco_release_transition','pitacco_owner_copy_catalog','pitacco_owner_repair_decide','pitacco_owner_set_store_member_role','pitacco_owner_enable_ifood_linking','pitacco_owner_acknowledge_incident','pitacco_update_delivery_incident']) loop
 select pg_get_functiondef(r.signature) into d;pos:=strpos(lower(d),'begin');if pos=0 then raise exception 'Mutation guard anchor missing for %',r.proname;end if;
 d:=substr(d,1,pos+4)||format(E'\n if public.pitacco_is_platform_owner() then perform pitacco_private.control_require(''security'',true);\n insert into pitacco_private.control_audit(actor,action) values(auth.uid(),%L);end if;\n',r.proname)||substr(d,pos+5);
 execute d;
 end loop;
end $stepup$;
create function public.pitacco_control_database_check() returns jsonb language plpgsql security definer set search_path='' as $$
declare started timestamptz:=clock_timestamp();begin
 perform pitacco_private.control_require('health');perform 1 from public.stores limit 1;
 insert into pitacco_private.control_observations(service,status,observed_at,expires_at,source,summary) values('database','operational',now(),now()+interval '5 minutes','pitacco_control_database_check','Consulta autenticada ao cadastro central concluída; não verifica todos os serviços.') on conflict(service) do update set status=excluded.status,observed_at=excluded.observed_at,expires_at=excluded.expires_at,source=excluded.source,summary=excluded.summary;
 return jsonb_build_object('observed_at',clock_timestamp(),'database_ms',greatest(0,extract(epoch from clock_timestamp()-started)*1000),'status','operational');
end $$;
revoke all on function public.pitacco_control_database_check() from public,anon,authenticated;
grant execute on function public.pitacco_control_database_check() to authenticated;
-- Cohort measurements start with observed data; no historical churn is fabricated.
create table pitacco_private.control_plan_observed(store_id uuid primary key references public.stores(id),plan_code text,paid boolean not null,seen_free boolean not null,observed_at timestamptz not null);
create table pitacco_private.control_cohorts(day date primary key,observed_at timestamptz not null,free_ids uuid[] not null,paid_ids uuid[] not null);
alter table pitacco_private.control_plan_observed enable row level security;
alter table pitacco_private.control_cohorts enable row level security;
revoke all on pitacco_private.control_plan_observed,pitacco_private.control_cohorts from public,anon,authenticated;
create index control_lifecycle_time on pitacco_private.control_lifecycle(occurred_at,store_id);
create function pitacco_private.control_capture_cohort() returns void language plpgsql set search_path='' as $$
declare r record;previous pitacco_private.control_plan_observed%rowtype;day_br date:=(now() at time zone 'America/Sao_Paulo')::date;begin
 if not pg_try_advisory_xact_lock(17428,92837) then return;end if;
 for r in select s.id,c.plan_code,(c.plan_code='complete' and st.status='active') is true as paid from public.stores s cross join lateral pitacco_private.subscription_state(s.id)st left join lateral(select cc.plan_code from pitacco_private.commercial_contracts cc where cc.store_id=s.id and cc.effective_from<=day_br and (cc.valid_from_at is null or cc.valid_from_at<=now()) and (cc.valid_until_at is null or cc.valid_until_at>now()) order by cc.effective_from desc,cc.created_at desc limit 1)c on true loop
  select * into previous from pitacco_private.control_plan_observed where store_id=r.id;
  if found then
   if previous.seen_free and r.paid and not previous.paid then insert into pitacco_private.control_lifecycle(store_id,event) values(r.id,'free_to_paid');end if;
   if previous.paid and r.plan_code='free' then insert into pitacco_private.control_lifecycle(store_id,event) values(r.id,'paid_to_free');end if;
  end if;
  insert into pitacco_private.control_plan_observed values(r.id,r.plan_code,r.paid,coalesce(r.plan_code='free',false) or coalesce(previous.seen_free,false) and not r.paid,now()) on conflict(store_id) do update set plan_code=excluded.plan_code,paid=excluded.paid,seen_free=excluded.seen_free,observed_at=excluded.observed_at;
 end loop;
 insert into pitacco_private.control_cohorts(day,observed_at,free_ids,paid_ids) select day_br,now(),coalesce(array_agg(store_id) filter(where plan_code='free'),'{}'),coalesce(array_agg(store_id) filter(where paid),'{}') from pitacco_private.control_plan_observed on conflict(day) do nothing;
end $$;
revoke all on function pitacco_private.control_capture_cohort() from public,anon,authenticated;
-- Enrich the dashboard without changing its verified financial definitions.
do $cohort$ declare d text;begin
 select pg_get_functiondef('public.pitacco_control_dashboard(date,date)'::regprocedure) into d;
 d:=replace(d,'STABLE','VOLATILE');
 d:=replace(d,$a$perform pitacco_private.control_require('analytics');$a$,$a$perform pitacco_private.control_require('analytics'); perform pitacco_private.control_capture_cohort();$a$);
 d:=replace(d,'return result;', $r$
 result:=result||jsonb_build_object('cohort',(select jsonb_build_object('observed_at',c.observed_at,'free_base',cardinality(c.free_ids),'paid_base',cardinality(c.paid_ids),'conversions',(select count(distinct e.store_id) from pitacco_private.control_lifecycle e where e.event='free_to_paid' and e.store_id=any(c.free_ids) and e.occurred_at>=c.observed_at and e.occurred_at<end_at),'cancellations',(select count(distinct e.store_id) from pitacco_private.control_lifecycle e where e.event='paid_to_free' and e.store_id=any(c.paid_ids) and e.occurred_at>=c.observed_at and e.occurred_at<end_at)) from pitacco_private.control_cohorts c where c.day=p_start));
 result:=result||jsonb_build_object('forecast',(select coalesce(jsonb_agg(to_jsonb(x) order by day),'[]') from(select d::date as day,(select coalesce(sum(i.amount_cents),0)/100.0 from pitacco_private.commercial_invoices i left join pitacco_private.commercial_manual_payments p on p.invoice_id=i.id where p.invoice_id is null and (i.due_at at time zone 'America/Sao_Paulo')::date=d::date) as receivables from generate_series(((now() at time zone 'America/Sao_Paulo')::date)::timestamp,((now() at time zone 'America/Sao_Paulo')::date+29)::timestamp,interval '1 day')d)x));
 return result;
 $r$);
 execute d;
end $cohort$;
create table pitacco_private.control_courier_versions(courier_id uuid not null references public.couriers(id),session_id uuid not null,version text not null check(version ~ '^[0-9]+[.][0-9]+[.][0-9]+$'),observed_at timestamptz not null default now(),primary key(courier_id,session_id));
alter table pitacco_private.control_courier_versions enable row level security;
revoke all on pitacco_private.control_courier_versions from public,anon,authenticated;
create function public.pitacco_control_courier_version(p_version text) returns void language plpgsql security definer set search_path='' as $$
declare c uuid;sid uuid:=nullif(auth.jwt()->>'session_id','')::uuid;begin
 if auth.uid() is null or sid is null or not public.pitacco_courier_session_ready() then raise exception 'Sessão do entregador indisponível' using errcode='42501';end if;
 if p_version is null or p_version !~ '^[0-9]+[.][0-9]+[.][0-9]+$' or length(p_version)>30 then raise exception 'Versão inválida';end if;
 select id into c from public.couriers where user_id=auth.uid() and active;
 if c is null then raise exception 'Entregador indisponível';end if;
 insert into pitacco_private.control_courier_versions(courier_id,session_id,version) values(c,sid,p_version) on conflict(courier_id,session_id) do update set version=excluded.version,observed_at=now() where pitacco_private.control_courier_versions.version<>excluded.version or pitacco_private.control_courier_versions.observed_at<now()-interval '1 minute';
end $$;
revoke all on function public.pitacco_control_courier_version(text) from public,anon,authenticated;
grant execute on function public.pitacco_control_courier_version(text) to authenticated;
do $versions$ declare d text;begin
 select pg_get_functiondef('public.pitacco_control_rows(text,uuid,integer,text)'::regprocedure) into d;
 d:=replace(d,$a$'android',null::text,p.observed_at,$a$,$a$'android',(select v.version from pitacco_private.control_courier_versions v where v.courier_id=c.id order by v.observed_at desc limit 1),p.observed_at,$a$);
 d:=replace(d,'Posição recebida; versão nativa ainda sem telemetria','Posição recebida; versão do último app autenticado quando informada');execute d;
end $versions$;
-- Optional compatibility policy. No minimum is activated by this migration.
create table pitacco_private.control_update_policy(app text primary key check(app in ('windows','android')),minimum_version text,reason text not null,updated_by uuid not null,updated_at timestamptz not null default now());
create table pitacco_private.control_windows_sessions(session_id uuid primary key,user_id uuid not null,store_id uuid not null references public.stores(id),device_id uuid not null,version text,observed_at timestamptz not null default now());
alter table pitacco_private.control_update_policy enable row level security;
alter table pitacco_private.control_windows_sessions enable row level security;
revoke all on pitacco_private.control_update_policy,pitacco_private.control_windows_sessions from public,anon,authenticated;
create function pitacco_private.control_version_below(p_version text,p_minimum text) returns boolean language sql immutable set search_path='' as $$select case when p_minimum is null then false when p_version is null or p_version !~ '^[0-9]{1,6}[.][0-9]{1,6}[.][0-9]{1,6}$' then true else string_to_array(p_version,'.')::int[]<string_to_array(p_minimum,'.')::int[] end$$;
revoke all on function pitacco_private.control_version_below(text,text) from public,anon,authenticated;
create function public.pitacco_control_update_policy(p_app text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if auth.uid() is null or p_app is null or p_app not in ('windows','android') then raise exception 'Consulta não autorizada' using errcode='42501';end if;
 select jsonb_build_object('app',app,'minimum_version',minimum_version,'reason',reason,'updated_at',updated_at) into result from pitacco_private.control_update_policy where app=p_app;return coalesce(result,jsonb_build_object('app',p_app,'minimum_version',null));
end $$;
create function public.pitacco_control_set_update_policy(p_app text,p_minimum text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform pitacco_private.control_require('security',true);
 if not public.pitacco_is_platform_owner() then raise exception 'Ação exclusiva do proprietário' using errcode='42501';end if;
 if p_app is null or p_app not in ('windows','android') or (p_minimum is not null and p_minimum !~ '^[0-9]{1,6}[.][0-9]{1,6}[.][0-9]{1,6}$') or length(btrim(coalesce(p_reason,''))) not between 10 and 500 then raise exception 'Informe aplicativo, versão válida e justificativa';end if;
 insert into pitacco_private.control_update_policy(app,minimum_version,reason,updated_by) values(p_app,p_minimum,btrim(p_reason),auth.uid()) on conflict(app) do update set minimum_version=excluded.minimum_version,reason=excluded.reason,updated_by=auth.uid(),updated_at=now();
 insert into pitacco_private.control_audit(actor,action,details) values(auth.uid(),'update_policy',jsonb_build_object('app',p_app,'minimum_version',p_minimum,'reason',p_reason));return public.pitacco_control_update_policy(p_app);
end $$;
revoke all on function public.pitacco_control_update_policy(text),public.pitacco_control_set_update_policy(text,text,text) from public,anon,authenticated;
grant execute on function public.pitacco_control_update_policy(text),public.pitacco_control_set_update_policy(text,text,text) to authenticated;
create function pitacco_private.control_require_current_windows() returns void language plpgsql stable set search_path='' as $$
declare installed text;minimum text;sid uuid:=nullif(auth.jwt()->>'session_id','')::uuid;begin
 select minimum_version into minimum from pitacco_private.control_update_policy where app='windows';if minimum is null then return;end if;
 select version into installed from pitacco_private.control_windows_sessions where session_id=sid and user_id=auth.uid();if not found then return;end if;
 if pitacco_private.control_version_below(installed,minimum) then raise exception 'Atualização do Pitacco Windows necessária para iniciar novas vendas. Os pedidos em andamento continuam disponíveis.' using errcode='42501';end if;
end $$;
create function pitacco_private.control_require_current_courier(p_courier uuid) returns void language plpgsql stable set search_path='' as $$
declare installed text;minimum text;begin
 select minimum_version into minimum from pitacco_private.control_update_policy where app='android';if minimum is null then return;end if;
 select version into installed from pitacco_private.control_courier_versions where courier_id=p_courier order by observed_at desc limit 1;
 if pitacco_private.control_version_below(installed,minimum) then raise exception 'O entregador precisa atualizar o aplicativo antes de receber novas entregas. Entregas em andamento não são bloqueadas.' using errcode='42501';end if;
end $$;
revoke all on function pitacco_private.control_require_current_windows(),pitacco_private.control_require_current_courier(uuid) from public,anon,authenticated;
do $compatibility$ declare d text;r record;pos integer;begin
 select pg_get_functiondef('public.pitacco_windows_ping(uuid,uuid)'::regprocedure) into d;pos:=strpos(lower(d),'begin');
 d:=substr(d,1,pos+4)||$g$
 if auth.uid() is not null and auth.jwt()->>'session_id' is not null and public.pitacco_can_manage_store(p_store) then insert into pitacco_private.control_windows_sessions(session_id,user_id,store_id,device_id) values((auth.jwt()->>'session_id')::uuid,auth.uid(),p_store,p_device) on conflict(session_id) do update set store_id=excluded.store_id,device_id=excluded.device_id,observed_at=now();end if;
 $g$||substr(d,pos+5);execute d;
 select pg_get_functiondef('public.pitacco_control_device_ping(uuid,uuid,text,text)'::regprocedure) into d;
 d:=replace(d,'end $function$', 'end $function$');
 -- The reported build belongs only to the same authenticated Windows session.
 pos:=strpos(d,'insert into pitacco_private.control_device_versions');
 if pos=0 then raise exception 'Device heartbeat anchor missing';end if;
 d:=substr(d,1,pos-1)||$g$if auth.jwt()->>'session_id' is not null then insert into pitacco_private.control_windows_sessions(session_id,user_id,store_id,device_id,version) values((auth.jwt()->>'session_id')::uuid,auth.uid(),p_store,p_device,p_version) on conflict(session_id) do update set version=excluded.version,observed_at=now();end if;
 $g$||substr(d,pos);execute d;
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['pitacco_confirm_priced_merchant_checkout','pitacco_merchant_channel_checkout','pitacco_fiado_balcao_discount']) loop
 select pg_get_functiondef(r.signature) into d;pos:=strpos(lower(d),'begin');if pos=0 then raise exception 'Checkout compatibility guard anchor missing';end if;execute substr(d,1,pos+4)||E'\n perform pitacco_private.control_require_current_windows();\n'||substr(d,pos+5);
 end loop;
 select pg_get_functiondef('public.assign_order_courier(uuid,uuid,boolean)'::regprocedure) into d;pos:=strpos(lower(d),'begin');execute substr(d,1,pos+4)||$g$
 if auth.uid() is not null and public.is_store_manager((select store_id from public.deliveries where id=p_delivery)) then perform pitacco_private.control_require_current_courier(p_courier);end if;
 $g$||substr(d,pos+5);
 select pg_get_functiondef('public.set_courier_availability(boolean)'::regprocedure) into d;pos:=strpos(lower(d),'begin');execute substr(d,1,pos+4)||$g$
 if is_available then perform pitacco_private.control_require_current_courier((select id from public.couriers where user_id=auth.uid() and active limit 1));end if;
 $g$||substr(d,pos+5);
end $compatibility$;
create function pitacco_private.control_delivery_version_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.courier_id is not null and (tg_op='INSERT' or new.courier_id is distinct from old.courier_id) then perform pitacco_private.control_require_current_courier(new.courier_id);end if;return new;
end $$;
revoke all on function pitacco_private.control_delivery_version_guard() from public,anon,authenticated;
create trigger pitacco_control_delivery_version before insert or update of courier_id on public.deliveries for each row execute function pitacco_private.control_delivery_version_guard();
