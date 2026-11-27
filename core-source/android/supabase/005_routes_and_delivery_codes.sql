-- Execute após 004_dispatch_mobile.sql. Segurança de códigos por canal.
alter table public.deliveries add column if not exists source text not null default 'proprio'
  check (source in ('proprio','ifood','99food','keeta'));
alter table public.deliveries add column if not exists requires_delivery_code boolean not null default false;
alter table public.deliveries add column if not exists delivery_code_verified_at timestamptz;
-- Marketplace: nunca concluir com código exigido sem confirmação registrada por backend confiável.
create or replace function public.set_delivery_status(d uuid, next_status text) returns void
language plpgsql security definer set search_path='' as $$
declare rec public.deliveries%rowtype; manager boolean; driver boolean;
begin
 select * into rec from public.deliveries where id=d for update;
 if not found then raise exception 'Entrega inexistente'; end if;
 manager:=public.is_store_manager(rec.store_id);
 driver:=rec.courier_id is not null and public.is_courier(rec.courier_id);
 if not ((manager and ((rec.status='pendente' and next_status='cancelada') or (rec.status='atribuida' and next_status='cancelada'))) or
 (driver and ((rec.status='atribuida' and next_status='aceita') or (rec.status='aceita' and next_status='retirada') or (rec.status='retirada' and next_status='entregue')))) then
   raise exception 'Transição não permitida';
 end if;
 if next_status='entregue' and rec.requires_delivery_code and rec.delivery_code_verified_at is null then
   raise exception 'Código ainda não confirmado pela plataforma';
 end if;
 update public.deliveries set status=next_status,updated_at=now() where id=d;
end$$;
revoke all on function public.set_delivery_status(uuid,text) from public;
grant execute on function public.set_delivery_status(uuid,text) to authenticated;
-- Campos source/requires_delivery_code são definidos apenas por integração de backend confiável.
-- ATENÇÃO: criar fluxo de ingestão oficial antes de usar pedidos de marketplace.
