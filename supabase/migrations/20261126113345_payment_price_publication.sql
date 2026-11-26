-- Controlled publication: storing drafts never changes checkout prices.
-- Platform release remains closed until all clients and payment flows pass validation.
create table pitacco_private.payment_pricing_release (
 singleton boolean primary key default true check(singleton),
 publication_enabled boolean not null default false
);
alter table pitacco_private.payment_pricing_release enable row level security;
revoke all on pitacco_private.payment_pricing_release from public,anon,authenticated;
insert into pitacco_private.payment_pricing_release(singleton,publication_enabled) values(true,false);

create or replace function public.pitacco_payment_pricing_release_status(p_store uuid)
returns boolean language plpgsql stable security definer set search_path='' as $release$
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 return coalesce((select publication_enabled from pitacco_private.payment_pricing_release where singleton),false);
end $release$;
revoke all on function public.pitacco_payment_pricing_release_status(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_payment_pricing_release_status(uuid) to authenticated;

create or replace function public.pitacco_publish_payment_price(p_store uuid,p_channel text,p_method text,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $publish$
declare d pitacco_private.payment_pricing_drafts%rowtype; cfg public.public_menu_settings%rowtype; allowed text[]; release_open boolean;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_channel is null or p_channel not in ('cardapio','balcao') or p_method is null or p_method not in ('dinheiro','cartao_credito','cartao_debito','pix_manual','pix_maquininha') or coalesce(p_expected_revision,0)<1 then raise exception 'Forma de pagamento não elegível para publicação';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_store::text||':'||p_channel||':'||p_method,0));
 select * into d from pitacco_private.payment_pricing_drafts where store_id=p_store and channel=p_channel and method=p_method for update;
 if not found or d.revision is distinct from p_expected_revision then raise exception 'Configuração alterada. Atualize antes de publicar.';end if;
 select publication_enabled into release_open from pitacco_private.payment_pricing_release where singleton for share;
 if d.adjustment_bps<>0 then
  if not coalesce(release_open,false) then raise exception 'Publicação de preços ainda não liberada';end if;
  select * into cfg from public.public_menu_settings where store_id=p_store for share;
  allowed:=case when p_channel='balcao' then coalesce(cfg.pdv_payment_methods,cfg.payment_methods) else cfg.payment_methods end;
  if not coalesce(p_method=any(allowed) or (p_method in ('cartao_credito','cartao_debito') and 'cartao_entrega'=any(allowed)),false) then raise exception 'Habilite esta forma de pagamento antes de publicar';end if;
 end if;
 if d.active_revision is not distinct from d.revision and d.active_adjustment_bps is not distinct from d.adjustment_bps then return to_jsonb(d)-'store_id';end if;
 update pitacco_private.payment_pricing_drafts set active_adjustment_bps=d.adjustment_bps,active_revision=d.revision,updated_at=now()
 where store_id=p_store and channel=p_channel and method=p_method returning * into d;
 insert into public.operation_audit(store_id,actor,action,details) values(p_store,auth.uid(),'payment_price_published',jsonb_build_object('channel',p_channel,'method',p_method,'adjustment_bps',d.active_adjustment_bps,'revision',d.active_revision));
 return to_jsonb(d)-'store_id';
end $publish$;
revoke all on function public.pitacco_publish_payment_price(uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.pitacco_publish_payment_price(uuid,text,text,bigint) to authenticated;
notify pgrst,'reload schema';
