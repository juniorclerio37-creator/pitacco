-- Draft-only payment pricing policies. No checkout reads these rows until the
-- quote/confirmation integration is released. Voucher fees are internal costs.
create table if not exists pitacco_private.payment_pricing_drafts (
 store_id uuid not null references public.stores(id) on delete cascade,
 channel text not null check(channel in ('cardapio','balcao')),
 method text not null check(method in ('dinheiro','cartao_credito','cartao_debito','pix_manual','pix_maquininha','pix_online','credito_online','debito_online','voucher_alelo','voucher_pluxee','voucher_vr','voucher_ticket')),
 adjustment_bps integer not null default 0 check(adjustment_bps between -9999 and 10000),
 processing_cost_bps integer not null default 0 check(processing_cost_bps between 0 and 10000),
 revision bigint not null default 1 check(revision>0),
 updated_at timestamptz not null default now(),
 primary key(store_id,channel,method),
 check(method not like 'voucher_%' or adjustment_bps=0)

);
alter table pitacco_private.payment_pricing_drafts enable row level security;
revoke all on pitacco_private.payment_pricing_drafts from public,anon,authenticated;

-- Basis is net merchandise after coupons/rewards; freight is never adjusted.
-- Work in cents, round once. Costs never increase what the customer pays.
create or replace function pitacco_private.payment_price_breakdown(p_subtotal_cents bigint,p_discount_cents bigint,p_delivery_cents bigint,p_method text,p_adjustment_bps integer,p_processing_cost_bps integer)
returns jsonb language plpgsql immutable set search_path='' as $price$
declare base bigint; adjustment bigint; total bigint; cost bigint;
begin
 if p_subtotal_cents is null or p_discount_cents is null or p_delivery_cents is null or p_method is null or p_adjustment_bps is null or p_processing_cost_bps is null or
 p_subtotal_cents not between 0 and 1000000 or p_discount_cents not between 0 and p_subtotal_cents or p_delivery_cents not between 0 and 100000 or
 p_adjustment_bps not between -9999 and 10000 or p_processing_cost_bps not between 0 and 10000 then raise exception 'Valores da política de pagamento inválidos';end if;
 if p_method not in ('dinheiro','cartao_credito','cartao_debito','pix_manual','pix_maquininha','pix_online','credito_online','debito_online','voucher_alelo','voucher_pluxee','voucher_vr','voucher_ticket','fiado') then raise exception 'Forma de pagamento inválida';end if;
 if (p_method like 'voucher_%' or p_method='fiado') and p_adjustment_bps<>0 then raise exception 'Ajuste de preço não permitido para esta forma';end if;
 base:=p_subtotal_cents-p_discount_cents;
 adjustment:=round(base::numeric*p_adjustment_bps/10000)::bigint;
 total:=base+adjustment+p_delivery_cents;
 if total<1 or total>1000000 then raise exception 'Valor final fora do limite';end if;
 cost:=round(total::numeric*p_processing_cost_bps/10000)::bigint;
 return jsonb_build_object('subtotal_cents',p_subtotal_cents,'discount_cents',p_discount_cents,'delivery_cents',p_delivery_cents,
 'adjustment_bps',p_adjustment_bps,'adjustment_cents',adjustment,'total_cents',total,'estimated_processing_cost_cents',cost,
 'loyalty_eligible_cents',case when p_method='fiado' then 0 else greatest(0,base+least(adjustment,0)) end);
end $price$;
revoke all on function pitacco_private.payment_price_breakdown(bigint,bigint,bigint,text,integer,integer) from public,anon,authenticated;

create or replace function public.pitacco_payment_pricing_drafts(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $draft$
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(d)-'store_id' order by d.channel,d.method) from pitacco_private.payment_pricing_drafts d where d.store_id=p_store),'[]'::jsonb);
end $draft$;
revoke all on function public.pitacco_payment_pricing_drafts(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_payment_pricing_drafts(uuid) to authenticated;

create or replace function public.pitacco_save_payment_pricing_draft(p_store uuid,p_channel text,p_method text,p_adjustment_bps integer,p_processing_cost_bps integer,p_expected_revision bigint default 0)
returns jsonb language plpgsql security definer set search_path='' as $draft$
declare d pitacco_private.payment_pricing_drafts%rowtype;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_expected_revision is null or p_expected_revision<0 then raise exception 'Revisão inválida';end if;
 perform pitacco_private.payment_price_breakdown(10000,0,0,p_method,p_adjustment_bps,p_processing_cost_bps);
 if p_channel not in ('cardapio','balcao') or p_channel is null or p_method='fiado' then raise exception 'Canal ou forma inválidos';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_store::text||':'||p_channel||':'||p_method,0));
 select * into d from pitacco_private.payment_pricing_drafts where store_id=p_store and channel=p_channel and method=p_method;
 if coalesce(d.revision,0)<>p_expected_revision then raise exception 'Configuração alterada. Atualize antes de salvar.';end if;
 insert into pitacco_private.payment_pricing_drafts(store_id,channel,method,adjustment_bps,processing_cost_bps)
 values(p_store,p_channel,p_method,p_adjustment_bps,p_processing_cost_bps)
 on conflict(store_id,channel,method) do update set adjustment_bps=excluded.adjustment_bps,processing_cost_bps=excluded.processing_cost_bps,revision=payment_pricing_drafts.revision+1,updated_at=now()
 returning * into d;
 insert into public.operation_audit(store_id,actor,action,details) values(p_store,auth.uid(),'payment_pricing_draft_saved',jsonb_build_object('channel',p_channel,'method',p_method,'adjustment_bps',p_adjustment_bps,'processing_cost_bps',p_processing_cost_bps,'revision',d.revision));
 return to_jsonb(d)-'store_id';
end $draft$;
revoke all on function public.pitacco_save_payment_pricing_draft(uuid,text,text,integer,integer,bigint) from public,anon,authenticated;
grant execute on function public.pitacco_save_payment_pricing_draft(uuid,text,text,integer,integer,bigint) to authenticated;
notify pgrst,'reload schema';
