-- CI only. Reuse the original audited, idempotent reprint routine.
create function core_auth.own_reprint_fixture(s uuid,o uuid,r uuid,reason text) returns boolean
language plpgsql security definer set search_path='' as $$
declare current_order public.orders%rowtype;
begin
 if not core_auth.can_act(s) then return false;end if;
 select x.* into current_order from public.orders x where x.id=o and x.store_id=s and x.source='proprio' for update;
 if not found then return false;end if;
 if current_order.status<>'accepted' or r is null or r='00000000-0000-0000-0000-000000000000' or length(trim(coalesce(reason,''))) not between 5 and 240 then
  raise exception 'Reimpressão indisponível' using errcode='22023';
 end if;
 perform public.reprint_order(o,r,reason);
 return true;
end $$;
revoke all on function core_auth.own_reprint_fixture(uuid,uuid,uuid,text) from public,anon,authenticated;
create role pitacco_core_own_print login password 'ci-own-print-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema core_auth to pitacco_core_own_print;
grant execute on function core_auth.can_act(uuid),core_auth.own_reprint_fixture(uuid,uuid,uuid,text) to pitacco_core_own_print;

-- CI only. Original device/queue routines, restricted to synthetic own orders.
create function core_auth.own_print_queue_fixture(s uuid,op text,device uuid,job uuid,st text,err text) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare result jsonb;
begin
 if not core_auth.can_act(s) then raise exception 'Escopo não autorizado' using errcode='42501';end if;
 if device is null or device='00000000-0000-0000-0000-000000000000' then raise exception 'Dispositivo inválido' using errcode='22023';end if;
 -- Serialize all experimental queue/device operations for this store.
 perform 1 from public.stores where id=s for update;
 if op='bind' then
  perform public.bind_print_device(s,device);
  return jsonb_build_object('bound',true);
 end if;
 if not exists(select 1 from public.print_devices d where d.store_id=s and d.device_id=device) then raise exception 'Dispositivo não autorizado' using errcode='42501';end if;
 if op='claim' then
  -- Test database ONLY: serialize with any concurrent queue write so the
  -- original unfiltered claim routine cannot claim a marketplace job.
  lock table public.print_jobs in share row exclusive mode;
  if exists(select 1 from public.print_jobs j left join public.orders o on o.id=j.order_id and o.store_id=j.store_id where j.store_id=s and j.state<>'submitted' and o.source is distinct from 'proprio') then
   raise exception 'Fila exige integração específica' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'store_id',j.store_id,'order_id',j.order_id,'sector',j.sector,'printer',j.printer,'width',j.width,'copy_no',j.copy_no,'request_id',j.request_id,'state',j.state,'created_at',j.created_at,'receipt',core_auth.board_receipt_fixture(j.receipt)||jsonb_build_object('source','proprio')) order by j.created_at,j.id),'[]'::jsonb)
  into result from public.claim_print_jobs(s,device) j;
  return jsonb_build_object('jobs',result);
 elsif op='ack' then
  if st is null or st not in ('saved','submitted','uncertain','error') or length(coalesce(err,''))>240 then raise exception 'Estado inválido' using errcode='22023';end if;
  if not exists(select 1 from public.print_jobs j join public.orders o on o.id=j.order_id and o.store_id=j.store_id where j.id=job and j.store_id=s and o.source='proprio' and j.device_id=device) then raise exception 'Trabalho não autorizado' using errcode='42501';end if;
  perform public.ack_print_job(job,device,st,err);
  return jsonb_build_object('acknowledged',true);
 end if;
 raise exception 'Operação inválida' using errcode='22023';
end $fn$;
revoke all on function core_auth.own_print_queue_fixture(uuid,text,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function core_auth.own_print_queue_fixture(uuid,text,uuid,uuid,text,text) to pitacco_core_own_print;

-- CI only: reuse original switch, unbind and presence functions. The
-- expected device prevents stale commands from moving another device's queue.
create function core_auth.own_print_device_fixture(s uuid,op text,device uuid,expected uuid) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare current_device uuid; result jsonb;
begin
 if not core_auth.can_act(s) then raise exception 'Escopo não autorizado' using errcode='42501';end if;
 perform 1 from public.stores where id=s for update;
 select d.device_id into current_device from public.print_devices d where d.store_id=s;
 if op='status' then
  return public.pitacco_windows_connection(s)||jsonb_build_object('bound_device_id',current_device);
 end if;
 if device is null or device='00000000-0000-0000-0000-000000000000' then raise exception 'Dispositivo inválido' using errcode='22023';end if;
 if op='ping' then return public.pitacco_windows_ping(s,device);end if;
 if op not in ('switch','unbind') then raise exception 'Operação inválida' using errcode='22023';end if;
 if current_device is distinct from expected then raise exception 'Vínculo mudou' using errcode='22023';end if;
 if op='switch' and current_device=device then return jsonb_build_object('bound',true);end if;
 if op='unbind' and current_device is distinct from device then raise exception 'Dispositivo não autorizado' using errcode='42501';end if;
 -- Additional conservative guard for errors as well as claimed/saved/uncertain.
 -- A failed spooler job is not proof that no paper was emitted.
 if current_device is not null and exists(select 1 from public.print_jobs j where j.store_id=s and j.device_id=current_device and j.state<>'submitted') then
  raise exception 'Trabalhos não conciliados' using errcode='22023';
 end if;
 if op='switch' then
  perform public.pitacco_switch_print_device(s,device);
  return jsonb_build_object('bound',true);
 end if;
 perform public.pitacco_unbind_print_device(s,device);
 return jsonb_build_object('unbound',true);
end $fn$;
revoke all on function core_auth.own_print_device_fixture(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function core_auth.own_print_device_fixture(uuid,text,uuid,uuid) to pitacco_core_own_print;

-- CI only. Original reprint for officially accepted iFood orders.
-- Queue claim stays isolated until authorized mixed print projection is migrated.
create function core_auth.ifood_reprint_fixture(s uuid,o uuid,r uuid,reason text) returns boolean
language plpgsql security definer set search_path='' as $$
declare current_order public.orders%rowtype;
begin
 if not core_auth.can_act(s) then return false;end if;
 select x.* into current_order from public.orders x where x.id=o and x.store_id=s and x.source='ifood' for update;
 if not found then return false;end if;
 if current_order.status<>'accepted' or coalesce(current_order.receipt->>'ifood_status','') not in ('CONFIRMED','READY_TO_PICKUP','DISPATCHED','CONCLUDED')
 or coalesce(current_order.receipt->>'ifood_manual_cancel','')='requested'
 or r is null or r='00000000-0000-0000-0000-000000000000' or length(trim(coalesce(reason,''))) not between 5 and 240 then
  raise exception 'Reimpressão indisponível' using errcode='22023';
 end if;
 perform public.reprint_order(o,r,reason);
 return true;
end $$;
revoke all on function core_auth.ifood_reprint_fixture(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function core_auth.ifood_reprint_fixture(uuid,uuid,uuid,text) to pitacco_core_own_print;

-- Original approved cupom, restricted to its supported scalar/nested shape.
-- For iFood remove every historical contact alias; only the private active
-- delivery contact is reintroduced. Never expose raw provider receipt_text.
create function core_auth.unified_print_receipt_fixture(v jsonb,src text,oid uuid,s uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; contact jsonb;
begin
 result:=core_auth.board_receipt_fixture(v)
 ||core_auth.board_scalars_fixture(v,array['marketplace_order_number','original_order_number'])
 ||case when jsonb_typeof(v->'customer')='object' then jsonb_build_object('customer',core_auth.board_scalars_fixture(v->'customer',array['name'])) else '{}'::jsonb end
 ||case when jsonb_typeof(v->'store')='object' then jsonb_build_object('store',core_auth.board_scalars_fixture(v->'store',array['name'])) else '{}'::jsonb end
 ||jsonb_build_object('source',src);
 if src='ifood' then
  result:=result-array['phone','customer_phone','localizer','localizador','locator','order_locator','delivery_locator','external_locator','pickup_locator','phone_localizer','phone_localizer_expiration','contact_expires_at'];
  select jsonb_strip_nulls(jsonb_build_object('phone',ct.phone_number,'localizer',ct.phone_localizer,'phone_localizer_expiration',ct.phone_expires_at))
  into contact from public.orders o join public.deliveries d on d.order_id=o.id and d.store_id=o.store_id
  join public.pitacco_delivery_customer_contacts ct on ct.delivery_id=d.id and ct.store_id=d.store_id
  where o.id=oid and o.store_id=s and o.source='ifood' and o.status='accepted' and o.preparation_status<>'completed'
   and coalesce(o.receipt->>'ifood_status','') not in ('CONCLUDED','CANCELLED')
   and d.source='ifood' and d.logistics_provider='loja' and d.status not in ('cancelada','entregue')
   and (ct.phone_expires_at is null or ct.phone_expires_at>now())
  order by ct.updated_at desc limit 1;
  result:=result||coalesce(contact,'{}'::jsonb);
 end if;
 return result;
end $$;
revoke all on function core_auth.unified_print_receipt_fixture(jsonb,text,uuid,uuid) from public,anon,authenticated;

create function core_auth.unified_print_queue_fixture(s uuid,op text,device uuid,job uuid,st text,err text) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare result jsonb;
begin
 if not core_auth.can_act(s) then raise exception 'Escopo não autorizado' using errcode='42501';end if;
 if device is null or device='00000000-0000-0000-0000-000000000000' then raise exception 'Dispositivo inválido' using errcode='22023';end if;
 -- Serialize all experimental queue/device operations for this store.
 perform 1 from public.stores where id=s for update;
 if op='bind' then
  perform public.bind_print_device(s,device);
  return jsonb_build_object('bound',true);
 end if;
 if not exists(select 1 from public.print_devices d where d.store_id=s and d.device_id=device) then raise exception 'Dispositivo não autorizado' using errcode='42501';end if;
 if op='claim' then
  -- Test database ONLY: serialize with any concurrent queue write so the
  -- original unfiltered claim routine cannot claim a marketplace job.
  lock table public.print_jobs in share row exclusive mode;
  if exists(select 1 from public.print_jobs j left join public.orders o on o.id=j.order_id and o.store_id=j.store_id where j.store_id=s and j.state<>'submitted' and (o.source is null or o.source not in ('proprio','ifood'))) then
   raise exception 'Fila exige integração específica' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'store_id',j.store_id,'order_id',j.order_id,'sector',j.sector,'printer',j.printer,'width',j.width,'copy_no',j.copy_no,'request_id',j.request_id,'state',j.state,'created_at',j.created_at,'receipt',core_auth.unified_print_receipt_fixture(j.receipt,o.source,j.order_id,j.store_id)) order by j.created_at,j.id),'[]'::jsonb)
  into result from public.claim_print_jobs(s,device) j join public.orders o on o.id=j.order_id and o.store_id=j.store_id;
  return jsonb_build_object('jobs',result);
 elsif op='ack' then
  if st is null or st not in ('saved','submitted','uncertain','error') or length(coalesce(err,''))>240 then raise exception 'Estado inválido' using errcode='22023';end if;
  if not exists(select 1 from public.print_jobs j join public.orders o on o.id=j.order_id and o.store_id=j.store_id where j.id=job and j.store_id=s and o.source in ('proprio','ifood') and j.device_id=device) then raise exception 'Trabalho não autorizado' using errcode='42501';end if;
  perform public.ack_print_job(job,device,st,err);
  return jsonb_build_object('acknowledged',true);
 end if;
 raise exception 'Operação inválida' using errcode='22023';
end $fn$;
revoke all on function core_auth.unified_print_queue_fixture(uuid,text,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function core_auth.unified_print_queue_fixture(uuid,text,uuid,uuid,text,text) to pitacco_core_own_print;

