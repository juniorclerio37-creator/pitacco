-- Candidate only. Install after reconciliation and issuance candidates, then test with all existing billing flows.
CREATE OR REPLACE FUNCTION pitacco_private.commercial_orders_blocked(p_store uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from pitacco_private.commercial_billing_control where singleton and enforce_own_orders)
 and exists(select 1 from pitacco_private.commercial_invoices i
 join pitacco_private.commercial_closings b using(contract_id,kind,period_end)
 left join pitacco_private.commercial_manual_payments p on p.invoice_id=i.id
 left join pitacco_private.commercial_asaas_charges a on a.invoice_id=i.id and a.environment='production'
 left join pitacco_private.commercial_asaas_issue_intents intent on intent.invoice_id=i.id
 where b.store_id=p_store and pitacco_private.commercial_invoice_status(i.amount_cents,b.amount_cents,b.state,(p.invoice_id is not null or coalesce(a.status in ('confirmed','received'),false)),i.due_at,i.grace_until)='overdue')
 and not exists(select 1 from pitacco_private.subscription_admin_controls a where a.store_id=p_store and a.courtesy_until>now())
$function$;

CREATE OR REPLACE FUNCTION public.pitacco_commercial_invoices(p_store uuid, p_page integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j jsonb;
begin
 if auth.uid() is null or not (public.pitacco_is_platform_owner() or (p_store is not null and public.is_store_manager(p_store))) then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_page is null or p_page not between 0 and 100000 then raise exception 'Página inválida' using errcode='22023';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.due_at desc,x.id),'[]'::jsonb) into j from (
 select i.id,b.store_id,s.name as store_name,i.kind,b.period_start,i.period_end,i.amount_cents,i.due_at,i.grace_until,
 case when a.status='review_required' then 'review_required' else pitacco_private.commercial_invoice_status(i.amount_cents,b.amount_cents,b.state,(p.invoice_id is not null or coalesce(a.status in ('confirmed','received'),false)),i.due_at,i.grace_until) end as status,
 coalesce(p.verified_at,case when a.status in ('confirmed','received') then a.verified_at end) as paid_at, a.status as asaas_status, (intent.invoice_id is null and a.invoice_id is null) as manual_available,claim.id as claim_id,claim.status as claim_status,claim.review_note,case when public.pitacco_is_platform_owner() then claim.reference else null end as claim_reference
 from pitacco_private.commercial_invoices i join pitacco_private.commercial_closings b using(contract_id,kind,period_end)
 join public.stores s on s.id=b.store_id left join pitacco_private.commercial_manual_payments p on p.invoice_id=i.id
 left join pitacco_private.commercial_asaas_charges a on a.invoice_id=i.id and a.environment='production'
 left join pitacco_private.commercial_asaas_issue_intents intent on intent.invoice_id=i.id
 left join lateral (select id,status,review_note,reference from pitacco_private.commercial_payment_claims where invoice_id=i.id order by created_at desc,id desc limit 1) claim on true
 where p_store is null or b.store_id=p_store order by i.due_at desc,i.id offset p_page*25 limit 26) x;
 return jsonb_build_object('rows',j-25,'has_more',jsonb_array_length(j)>25);
end $function$;

CREATE OR REPLACE FUNCTION public.pitacco_store_commercial_block_status(p_store uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare blocked boolean; v_stage text; due_time timestamptz; grace_time timestamptz; pending_count bigint; action_count bigint; total_count bigint;
begin
 if auth.uid() is null or not (public.pitacco_is_platform_owner() or public.can_access_store(p_store)) then raise exception 'Sem permissão' using errcode='42501';end if;
 blocked:=pitacco_private.commercial_orders_blocked(p_store);
 with unpaid as (
 select i.due_at,i.grace_until,
 pitacco_private.commercial_notice_stage(now(),i.due_at,i.grace_until) as stage,
 exists(select 1 from pitacco_private.commercial_payment_claims c where c.invoice_id=i.id and c.status='pending') as awaiting_review
 from pitacco_private.commercial_invoices i
 join pitacco_private.commercial_closings b using(contract_id,kind,period_end)
 left join pitacco_private.commercial_manual_payments p on p.invoice_id=i.id
 left join pitacco_private.commercial_asaas_charges a on a.invoice_id=i.id and a.environment='production'
 left join pitacco_private.commercial_asaas_issue_intents intent on intent.invoice_id=i.id
 where b.store_id=p_store and p.invoice_id is null and not coalesce(a.status in ('confirmed','received'),false) and b.state='calculated' and b.amount_cents=i.amount_cents
 ), relevant as (select * from unpaid where stage<>'none'), ranked as (
 select * from relevant order by case stage when 'overdue' then 1 when 'grace' then 2 else 3 end,grace_until,due_at limit 1
 )
 select (select r.stage from ranked r),(select r.due_at from ranked r),(select r.grace_until from ranked r),
 count(*) filter(where awaiting_review),count(*) filter(where not awaiting_review),count(*)
 into v_stage,due_time,grace_time,pending_count,action_count,total_count from relevant;
 return jsonb_build_object('orders_blocked',blocked,'notice_stage',case when blocked then 'blocked' else coalesce(v_stage,'none') end,
 'due_at',due_time,'grace_until',grace_time,'awaiting_review',pending_count,'payment_required',action_count,'unpaid_count',total_count);
end $function$;

CREATE OR REPLACE FUNCTION public.pitacco_submit_commercial_payment(p_invoice uuid, p_reference text, p_mime text, p_proof text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i pitacco_private.commercial_invoices%rowtype;b pitacco_private.commercial_closings%rowtype;data bytea;result uuid;
begin
 if auth.uid() is null then raise exception 'Sem permissão' using errcode='42501';end if;
 select * into i from pitacco_private.commercial_invoices where id=p_invoice for update;
 select * into b from pitacco_private.commercial_closings where contract_id=i.contract_id and kind=i.kind and period_end=i.period_end;
 if b.store_id is null or not public.is_store_manager(b.store_id) then raise exception 'Sem permissão' using errcode='42501';end if;
 if not exists(select 1 from pitacco_private.commercial_billing_control where pix_cnpj is not null and pix_recipient is not null) then raise exception 'Pix ainda não configurado' using errcode='22023';end if;
 if b.state<>'calculated' or i.amount_cents is distinct from b.amount_cents or exists(select 1 from pitacco_private.commercial_manual_payments where invoice_id=i.id) or exists(select 1 from pitacco_private.commercial_asaas_issue_intents where invoice_id=i.id) or exists(select 1 from pitacco_private.commercial_asaas_charges where invoice_id=i.id) then raise exception 'Cobrança indisponível para pagamento' using errcode='22023';end if;
 if length(btrim(coalesce(p_reference,''))) not between 5 and 160 or p_mime is null or p_mime not in ('application/pdf','image/jpeg','image/png') or length(coalesce(p_proof,'')) not between 12 and 2796204 then raise exception 'Comprovante inválido ou maior que 2 MB' using errcode='22023';end if;
 data:=decode(p_proof,'base64');
 if octet_length(data) not between 8 and 2097152 or
 (p_mime='application/pdf' and substring(data from 1 for 5)<>decode('255044462d','hex')) or
 (p_mime='image/jpeg' and substring(data from 1 for 3)<>decode('ffd8ff','hex')) or
 (p_mime='image/png' and substring(data from 1 for 8)<>decode('89504e470d0a1a0a','hex')) then raise exception 'Formato do comprovante inválido' using errcode='22023';end if;
 insert into pitacco_private.commercial_payment_claims(invoice_id,submitted_by,reference,mime,proof)
 values(i.id,auth.uid(),btrim(p_reference),p_mime,data) returning id into result;
 return result;
end $function$;

