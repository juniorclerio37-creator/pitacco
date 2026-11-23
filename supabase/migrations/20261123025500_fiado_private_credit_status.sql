-- Esta consulta NÃO informa limite, saldo, crédito reservado ou dívida.
-- Retorna apenas se o meio Fiado deve aparecer e se este pedido pode usá-lo.
-- O checkout real sempre valida o valor calculado pelo servidor.
create or replace function public.pitacco_fiado_checkout_status(
 p_slug text, p_phone text, p_order_total numeric
) returns jsonb language plpgsql stable security definer set search_path=''
as $fiado$
declare
 sid uuid;
 account public.pitacco_fiado_customers%rowtype;
 v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 v_blocked boolean:=false;
begin
 if v_phone !~ '^[0-9]{10,11}$' then
  return jsonb_build_object('visible',false,'enabled',false);
 end if;
 select m.store_id into sid
 from public.public_menu_settings m
 join public.pitacco_fiado_settings f on f.store_id=m.store_id
 where m.slug=p_slug and m.enabled and f.enabled limit 1;
 if sid is null then
  return jsonb_build_object('visible',false,'enabled',false);
 end if;
 select * into account from public.pitacco_fiado_customers c
 where c.store_id=sid and c.phone=v_phone and c.enabled limit 1;
 if not found then
  return jsonb_build_object('visible',false,'enabled',false);
 end if;
 v_blocked:=
   account.credential_hash is null
   or account.credential_locked_until>now()
   or (
     account.block_overdue and exists (
      select 1 from public.pitacco_fiado_charges d
      where d.customer_id=account.id and d.store_id=sid
        and d.state='open' and d.amount>d.paid and d.due_at<now()
     )
   )
   or coalesce(p_order_total,0)<=0
   or p_order_total>10000
   or p_order_total>greatest(0,account.credit_limit-account.used);

 return jsonb_build_object(
  'visible',true,
  'enabled',not v_blocked,
  'message',case when v_blocked then
   'Fiado indisponível para este pedido. Escolha outra forma de pagamento ou fale com a loja.'
   else null end
 );
end $fiado$;
revoke all on function public.pitacco_fiado_checkout_status(text,text,numeric)
 from public,anon,authenticated;
grant execute on function public.pitacco_fiado_checkout_status(text,text,numeric)
 to anon,authenticated;

-- A antiga verificação por código também não pode mais devolver crédito restante.
create or replace function public.pitacco_fiado_public_eligibility(
 p_slug text,p_phone text,p_code text
) returns jsonb language plpgsql security definer set search_path='' as $oldfiado$
declare
 sid uuid;cid uuid;account public.pitacco_fiado_customers%rowtype;
begin
 select store_id into sid from public.public_menu_settings where slug=p_slug and enabled;
 if sid is null then return jsonb_build_object('eligible',false);end if;
 cid:=pitacco_private.fiado_customer_access(sid,p_phone,p_code);
 if cid is null then return jsonb_build_object('eligible',false);end if;
 select * into account from public.pitacco_fiado_customers where id=cid and store_id=sid;
 if account.credit_limit<=account.used or
  (account.block_overdue and exists(
   select 1 from public.pitacco_fiado_charges c
   where c.store_id=sid and c.customer_id=cid and c.state='open'
    and c.amount>c.paid and c.due_at<now()
  )) then return jsonb_build_object('eligible',false);end if;
 return jsonb_build_object('eligible',true);
end $oldfiado$;
revoke all on function public.pitacco_fiado_public_eligibility(text,text,text)
 from public,anon,authenticated;
grant execute on function public.pitacco_fiado_public_eligibility(text,text,text)
 to anon,authenticated;
