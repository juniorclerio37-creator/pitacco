-- Fiado never earns or redeems loyalty benefits, even after full settlement.
do $migration$
declare def text; anchor text;
begin
 def:=pg_get_functiondef('pitacco_private.loyalty_refresh_order(uuid)'::regprocedure);
 anchor:='if l.earned_at is not null or l.reversed_at is not null then return;end if;';
 if strpos(def,anchor)=0 then raise exception 'Loyalty eligibility anchor missing';end if;
 execute replace(def,anchor,$a$if lower(coalesce(o.receipt->>'payment',''))='fiado'
  or lower(coalesce(o.receipt->>'payment_method',''))='fiado'
  or lower(coalesce(l.payload->>'payment',''))='fiado'
  or exists(select 1 from public.pitacco_fiado_charges fc where fc.order_id=oid and fc.store_id=l.store_id)
 then return;end if;
 $a$||anchor);
 def:=pg_get_functiondef('public.pitacco_loyalty_checkout(text,uuid,text,text,text,jsonb,text,text,text,text,text,text,uuid,timestamptz,text)'::regprocedure);
 anchor:='Fiado acumula benefícios após quitação e entrega.';
 if strpos(def,anchor)=0 then raise exception 'Fiado checkout message missing';end if;
 execute replace(def,anchor,'Pedidos fiados não acumulam nem utilizam benefícios do Fideliza+, mesmo após a quitação.');
end $migration$;
-- Defense in depth at the central ledger writer; preserve reversals and manual adjustments.
do $migration$
declare def text:=pg_get_functiondef('pitacco_private.loyalty_entry(uuid,uuid,uuid,text,integer,text,text,jsonb)'::regprocedure);
 anchor constant text:='if delta=0 then return;end if;';
begin
 if strpos(def,anchor)=0 then raise exception 'Loyalty ledger anchor missing';end if;
 execute replace(def,anchor,anchor||$a$
 if o is not null and event in ('earn','redeem') and (
  exists(select 1 from public.orders ord where ord.id=o and ord.store_id=s and
   (lower(coalesce(ord.receipt->>'payment',''))='fiado' or lower(coalesce(ord.receipt->>'payment_method',''))='fiado'))
  or exists(select 1 from public.pitacco_fiado_charges fc where fc.order_id=o and fc.store_id=s)
 ) then return;end if;$a$);
end $migration$;
drop trigger if exists loyalty_on_fiado_settlement on public.pitacco_fiado_charges;
notify pgrst,'reload schema';
