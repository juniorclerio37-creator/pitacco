-- iFood appointment orders must not enter the automatic confirmation queue.
do $migration$
declare def text; anchor text;
begin
 def:=pg_get_functiondef('pitacco_private.ifood_auto_candidates(uuid)'::regprocedure);
 anchor:=$a$and s.enabled and s.mode='automatic'$a$;
 if strpos(def,anchor)=0 then raise exception 'iFood auto candidate anchor missing';end if;
 execute replace(def,anchor,anchor||$a$ and nullif(o.receipt->>'provider_scheduled_for','') is null$a$);
 def:=pg_get_functiondef('public.pitacco_ifood_manual_request(uuid,uuid)'::regprocedure);
 anchor:=$a$if not pref.enabled or pref.mode <> 'manual' then$a$;
 if strpos(def,anchor)=0 then raise exception 'iFood manual request anchor missing';end if;
 execute replace(def,anchor,$a$if not pref.enabled or (pref.mode <> 'manual' and nullif(o.receipt->>'provider_scheduled_for','') is null) then$a$);
 -- The generic legacy endpoint is not installed in all fresh database snapshots.
 if to_regprocedure('public.pitacco_request_marketplace_acceptance(uuid,text)') is not null then
 def:=pg_get_functiondef('public.pitacco_request_marketplace_acceptance(uuid,text)'::regprocedure);
 anchor:=$a$if v_mode is distinct from 'automatic' then$a$;
 if strpos(def,anchor)=0 then raise exception 'Marketplace acceptance anchor missing';end if;
 execute replace(def,anchor,$a$if nullif(o.receipt->>'provider_scheduled_for','') is not null then raise exception 'Pedido agendado exige aceite manual da loja';end if;
 $a$||anchor);
 end if;
end $migration$;
notify pgrst,'reload schema';
