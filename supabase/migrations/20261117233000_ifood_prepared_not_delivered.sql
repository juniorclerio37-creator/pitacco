-- iFood readiness is not delivery completion.
-- The official CONCLUDED event is external evidence; never synthesize a delivered
-- courier status or a successful code validation from the kitchen preparation state.
-- Preserve any existing delivery, tracking, PIN, courier, batch and financial data.
do $guard$
declare
 v_oid oid;
 v_def text;
 v_new text;
begin
 v_oid:=pg_catalog.to_regprocedure('public.pitacco_ifood_complete(uuid,uuid,jsonb,boolean)');
 if v_oid is null then raise notice 'iFood complete function absent in isolated fixture'; else
   v_def:=pg_catalog.pg_get_functiondef(v_oid);
   if pg_catalog.strpos(v_def, 'next_preparation:=case e.code when ''CONCLUDED'' then ''completed''')=0 then
     raise exception 'Unexpected iFood state mapping; cannot safely patch';
   end if;
   v_new:=pg_catalog.replace(v_def,
    'next_preparation:=case e.code when ''CONCLUDED'' then ''completed''',
    'next_preparation:=case e.code when ''CONCLUDED'' then ''ready''');
   if pg_catalog.strpos(v_new,'update public.orders set status=next_status,preparation_status=next_preparation,')=0 then
     raise exception 'Unexpected iFood order update implementation';
   end if;
   v_new:=pg_catalog.replace(v_new,
    'update public.orders set status=next_status,preparation_status=next_preparation,',
    'update public.orders set status=next_status,preparation_status=case when e.code=''CONCLUDED'' then preparation_status else next_preparation end,');
   execute v_new;
 end if;
end
$guard$;

-- A provider-concluded iFood order may not be assigned after terminal status.
-- This guard covers both manual assignment and any future direct courier/batch RPC,
-- independent of what the browser currently displays.
create or replace function pitacco_private.guard_ifood_terminal_dispatch()
returns trigger
language plpgsql security definer set search_path='' as $$
declare
 v_status text;
begin
 if new.logistics_provider is distinct from 'loja' then return new;end if;
 if tg_op='UPDATE' then
  if new.courier_id is not distinct from old.courier_id
   and new.batch_id is not distinct from old.batch_id then
   return new;
  end if;
 end if;
 if new.courier_id is null and new.batch_id is null then return new;end if;
 select o.receipt->>'ifood_status' into v_status
 from public.orders o where o.id=new.order_id and o.store_id=new.store_id and o.source='ifood';
 if v_status in ('CONCLUDED','CANCELLED') then
  raise exception 'Pedido já encerrado no iFood. Não é possível atribuir entregador; atualize o pedido.'
   using errcode='22023';
 end if;
 return new;
end;
$$;

drop trigger if exists pitacco_guard_ifood_terminal_dispatch on public.deliveries;
create trigger pitacco_guard_ifood_terminal_dispatch
before insert or update of courier_id,batch_id on public.deliveries
for each row execute function pitacco_private.guard_ifood_terminal_dispatch();

comment on function pitacco_private.guard_ifood_terminal_dispatch() is
 'Apenas bloqueia NOVAS atribuições quando o iFood já enviou CONCLUDED/CANCELLED. Não conclui nem modifica entregas em andamento.';

notify pgrst, 'reload schema';
