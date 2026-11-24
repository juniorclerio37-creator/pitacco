
do $patch$
declare d text; a text;
begin
 select pg_get_functiondef('pitacco_private.refresh_flex_commission_closings()'::regprocedure) into d;
 a:='filter(where o.preparation_status=''completed'' or exists(select 1 from public.deliveries d where d.order_id=o.id and d.store_id=o.store_id and d.status=''entregue''))';
 if position(a in d)=0 then raise exception 'Commission aggregate changed';end if;
 d:=replace(d,a,'filter(where o.status=''accepted'' and (o.preparation_status=''completed'' or exists(select 1 from public.deliveries d where d.order_id=o.id and d.store_id=o.store_id and d.status=''entregue'')))');
 d:=replace(d,'filter(where (o.preparation_status=''completed'' or exists','filter(where o.status=''accepted'' and (o.preparation_status=''completed'' or exists');
 d:=replace(d,'filter(where coalesce(o.preparation_status,'''')<>''completed'' and not exists(select 1 from public.deliveries d where d.order_id=o.id and d.store_id=o.store_id and d.status=''entregue''))','filter(where o.status=''pending'' or (coalesce(o.preparation_status,'''')<>''completed'' and not exists(select 1 from public.deliveries d where d.order_id=o.id and d.store_id=o.store_id and d.status=''entregue'')))');
 execute d;
end $patch$;

