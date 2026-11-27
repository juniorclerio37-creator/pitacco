-- Public checkout is not a merchant session. Use a private, request-bound
-- automatic acceptance entrypoint; retain the original merchant permission gate.
do $migration$
declare
 def text:=pg_get_functiondef('pitacco_private.accept_own_with_schedule(uuid,boolean)'::regprocedure);
 permission_anchor constant text:=$a$if not (public.can_access_store(o.store_id) or coalesce(auth.jwt()->>'role','') = 'service_role') then raise exception 'Sem permissão para aceitar o pedido'; end if;$a$;
 source_anchor constant text:=$a$if o.source <> 'proprio' then$a$;
 guard constant text:=$g$if p_request is null or o.request_id is distinct from p_request or o.scheduled_for is not null
   or o.source is distinct from 'proprio'
   or not exists(select 1 from public.public_checkouts pc where pc.store_id=o.store_id and pc.order_id=o.id and pc.request_id=p_request)
   or not exists(select 1 from public.acceptance_settings a where a.store_id=o.store_id and a.source='proprio' and a.mode='automatic' and a.enabled)
   or (lower(coalesce(o.receipt->>'payment',''))='fiado' and exists(
      select 1 from public.pitacco_fiado_customers fc
      where fc.id=nullif(current_setting('pitacco.fiado_customer',true),'')::uuid and fc.approval_mode='manual'))
 then raise exception 'Aceite automático não autorizado para este checkout' using errcode='42501'; end if;$g$;
 signature regprocedure;
begin
 if strpos(def,'FUNCTION pitacco_private.accept_own_with_schedule(p_order uuid, p_manual boolean)')=0 or strpos(def,source_anchor)=0 then raise exception 'Unexpected acceptance definition';end if;
 def:=replace(def,'FUNCTION pitacco_private.accept_own_with_schedule(p_order uuid, p_manual boolean)','FUNCTION pitacco_private.accept_own_from_checkout(p_order uuid, p_request uuid)');
 -- Older test fixtures do not contain the production merchant permission check.
 -- Regardless of that difference, the new path always enforces the private guard.
 if strpos(def,permission_anchor)>0 then
  def:=replace(def,permission_anchor,guard);
 else
  def:=replace(def,source_anchor,guard||E'\n '||source_anchor);
 end if;
 def:=replace(def,'not p_manual','true');
 if strpos(def,'p_manual')>0 then raise exception 'Unexpected manual acceptance reference';end if;
 execute def;
 revoke all on function pitacco_private.accept_own_from_checkout(uuid,uuid) from public,anon,authenticated,service_role;
 foreach signature in array array[
  'public.checkout_public_order(text,uuid,text,text,text,jsonb,text,text,text)'::regprocedure,
  'public.checkout_public_order_coupon(text,uuid,text,text,text,jsonb,text,text,text,text)'::regprocedure
 ] loop
  def:=pg_get_functiondef(signature);
  if strpos(def,'perform public.dg_accept_own(oid)')=0 then raise exception 'Unexpected checkout acceptance definition: %',signature;end if;
  execute replace(def,'perform public.dg_accept_own(oid)','perform pitacco_private.accept_own_from_checkout(oid,p_request)');
 end loop;
end $migration$;
notify pgrst,'reload schema';
