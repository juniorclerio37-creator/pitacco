-- CI ONLY, explicit projections and no direct access to raw order records.
create function core_auth.board_scalars_fixture(v jsonb,keys text[]) returns jsonb
language sql immutable set search_path='' as $$
select coalesce(jsonb_object_agg(key,value),'{}'::jsonb)
from jsonb_each(case when jsonb_typeof(v)='object' then v else '{}'::jsonb end)
where key=any(keys) and jsonb_typeof(value) in ('string','number','boolean','null')
$$;
create function core_auth.board_modifier_tree_fixture(v jsonb,depth integer) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb;
begin
 if depth is null or depth>5 or jsonb_typeof(v) is distinct from 'array' then return '[]'::jsonb;end if;
 select coalesce(jsonb_agg(case when jsonb_typeof(x)='string' then x else
  core_auth.board_scalars_fixture(x,array['name','title','label','quantity','qty','price','unit_price','total','total_price','group','numerator','denominator'])
  || case when jsonb_typeof(x->'option')='object' then jsonb_build_object('option',core_auth.board_scalars_fixture(x->'option',array['name'])) else '{}'::jsonb end
  || case when depth<5 and jsonb_typeof(x->'options')='array' then jsonb_build_object('options',core_auth.board_modifier_tree_fixture(x->'options',depth+1)) else '{}'::jsonb end
  end order by n),'[]'::jsonb) into result
 from jsonb_array_elements(v) with ordinality as m(x,n)
 where jsonb_typeof(x) in ('string','object');
 return result;
end $$;
create function core_auth.board_modifiers_fixture(v jsonb) returns jsonb
language sql immutable set search_path='' as $$ select core_auth.board_modifier_tree_fixture(v,0) $$;
revoke all on function core_auth.board_modifier_tree_fixture(jsonb,integer) from public,anon,authenticated;
create function core_auth.board_receipt_fixture(v jsonb) returns jsonb
language sql immutable set search_path='' as $$
select core_auth.board_scalars_fixture(v,array['customer','customer_name','phone','customer_phone','address','delivery_address','logistics','display_number','external_order_number','order_number','display_id','number','payment','payment_method','payment_type','payment_timing','payment_when','payment_location','payment_channel','payment_status','payment_confirmed','paid','is_paid','payment_on_delivery','collect_on_delivery','amount_to_collect','amount_due','change_for','cash_given','troco_para','notes','observations','observacao','subtotal','delivery_fee','delivery_fee_original','total','discount','scheduled_for','scheduled_release_at','fulfillment_type','order_type','delivery_type','delivery_service','delivery_provider','logistics_provider','fulfillment_provider','delivery_estimate','estimated_delivery','reference','store_name','company_name','store_tagline','store_phone','created_at','date','payment_online','paid_online','service_fee','total_amount','localizer','localizador','locator','order_locator','delivery_locator','external_locator','pickup_locator','phone_localizer','phone_localizer_expiration','contact_expires_at'])
|| coalesce((select jsonb_object_agg(k,core_auth.board_scalars_fixture(v->k,array['street','street_name','logradouro','rua','line1','number','numero','neighborhood','bairro','city','cidade','state','uf','complement','complemento','line2','postal_code','cep','zip','zip_code','address'])) from unnest(array['address','delivery_address']) k where jsonb_typeof(v->k)='object'),'{}'::jsonb)
|| case when jsonb_typeof(v->'payment_price')='object' then jsonb_build_object('payment_price',core_auth.board_scalars_fixture(v->'payment_price',array['adjustment_cents'])) else '{}'::jsonb end
|| case when jsonb_typeof(v->'payment')='object' then jsonb_build_object('payment',core_auth.board_scalars_fixture(v->'payment',array['method','status'])) else '{}'::jsonb end
|| case when jsonb_typeof(v->'courier_collection')='object' then jsonb_build_object('courier_collection',core_auth.board_scalars_fixture(v->'courier_collection',array['received','amount','received_at'])) else '{}'::jsonb end
|| case when jsonb_typeof(v->'delivery_eta')='object' then jsonb_build_object('delivery_eta',core_auth.board_scalars_fixture(v->'delivery_eta',array['latest_at','earliest_at','min_minutes','max_minutes'])) else '{}'::jsonb end
|| jsonb_build_object('items',coalesce((select jsonb_agg(core_auth.board_scalars_fixture(x,array['name','title','quantity','qty','unit_price','unit_total','price','total','total_price','price_total','notes','observation','observacao'])||coalesce((select jsonb_object_agg(k,core_auth.board_modifiers_fixture(x->k)) from unnest(array['modifiers','addons','complements','options','additions']) k where jsonb_typeof(x->k)='array'),'{}'::jsonb) order by n) from jsonb_array_elements(case when jsonb_typeof(v->'items')='array' then v->'items' else '[]'::jsonb end) with ordinality as i(x,n) where jsonb_typeof(x)='object'),'[]'::jsonb))
$$;
create function core_auth.own_board_fixture(s uuid,lim integer,off integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not core_auth.can_act(s) then raise exception 'Escopo não autorizado' using errcode='42501';end if;
 if lim is null or lim not between 1 and 100 or off is null or off not between 0 and 10000 then raise exception 'Paginação inválida' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'store_id',o.store_id,'channel',o.channel,'gross',o.gross,'status',o.status,'source',o.source,'preparation_status',o.preparation_status,'created_at',o.created_at,'scheduled_for',o.scheduled_for,'scheduled_release_at',o.scheduled_release_at,'receipt',core_auth.board_receipt_fixture(o.receipt)) order by o.created_at desc,o.id desc),'[]'::jsonb)
 into result from (select * from public.pitacco_daily_operational_orders(s) where store_id=s and source='proprio' order by created_at desc,id desc limit lim offset off) o;
 return result;
end $$;
revoke all on function core_auth.board_scalars_fixture(jsonb,text[]),core_auth.board_modifiers_fixture(jsonb),core_auth.board_receipt_fixture(jsonb),core_auth.own_board_fixture(uuid,integer,integer) from public,anon,authenticated;
create role pitacco_core_own_board login password 'ci-own-board-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema core_auth to pitacco_core_own_board;
grant execute on function core_auth.can_act(uuid),core_auth.own_board_fixture(uuid,integer,integer) to pitacco_core_own_board;

-- Read existing settings without exposing device identifiers, jobs, or credentials.
create function core_auth.operation_settings_fixture(s uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not core_auth.can_act(s) then raise exception 'Escopo não autorizado' using errcode='42501';end if;
 select jsonb_build_object(
  'store_id',st.id,'dispatch_mode',st.dispatch_mode,
  'acceptance_settings',coalesce((select jsonb_agg(jsonb_build_object('store_id',a.store_id,'source',a.source,'mode',a.mode,'enabled',a.enabled) order by a.source) from public.acceptance_settings a where a.store_id=s),'[]'::jsonb),
  'print_sectors',coalesce((select jsonb_agg(jsonb_build_object('store_id',p.store_id,'sector',p.sector,'printer',p.printer,'width',p.width,'copies',p.copies,'enabled',p.enabled,'sources',coalesce(to_jsonb(p)->'sources','[]'::jsonb),'categories',coalesce(to_jsonb(p)->'categories','[]'::jsonb)) order by p.sector) from public.print_sectors p where p.store_id=s),'[]'::jsonb)
 ) into result from public.stores st where st.id=s;
 return result;
end $$;
revoke all on function core_auth.operation_settings_fixture(uuid) from public,anon,authenticated;
grant execute on function core_auth.operation_settings_fixture(uuid) to pitacco_core_own_board;
