-- CI ONLY, explicit projections and no direct access to raw order records.
create function core_auth.board_scalars_fixture(v jsonb,keys text[]) returns jsonb
language sql immutable set search_path='' as $$
select coalesce(jsonb_object_agg(key,value),'{}'::jsonb)
from jsonb_each(case when jsonb_typeof(v)='object' then v else '{}'::jsonb end)
where key=any(keys) and jsonb_typeof(value) in ('string','number','boolean','null')
$$;
create function core_auth.board_modifiers_fixture(v jsonb) returns jsonb
language sql immutable set search_path='' as $$
select coalesce(jsonb_agg(case when jsonb_typeof(x)='string' then x else core_auth.board_scalars_fixture(x,array['name','quantity','price','unit_price','total']) end order by n),'[]'::jsonb)
from jsonb_array_elements(case when jsonb_typeof(v)='array' then v else '[]'::jsonb end) with ordinality as m(x,n)
where jsonb_typeof(x) in ('string','object')
$$;
create function core_auth.board_receipt_fixture(v jsonb) returns jsonb
language sql immutable set search_path='' as $$
select core_auth.board_scalars_fixture(v,array['customer','customer_name','phone','customer_phone','address','delivery_address','logistics','display_number','external_order_number','order_number','display_id','number','payment','payment_method','payment_type','payment_timing','payment_when','payment_location','payment_channel','payment_status','payment_confirmed','paid','is_paid','payment_on_delivery','collect_on_delivery','amount_to_collect','amount_due','change_for','cash_given','troco_para','notes','observations','observacao','subtotal','delivery_fee','delivery_fee_original','total','discount','scheduled_for','scheduled_release_at','fulfillment_type','order_type','delivery_type'])
|| coalesce((select jsonb_object_agg(k,core_auth.board_scalars_fixture(v->k,array['street','street_name','logradouro','rua','line1','number','numero','neighborhood','bairro','city','cidade','state','uf','complement','complemento','line2','postal_code','cep'])) from unnest(array['address','delivery_address']) k where jsonb_typeof(v->k)='object'),'{}'::jsonb)
|| case when jsonb_typeof(v->'payment')='object' then jsonb_build_object('payment',core_auth.board_scalars_fixture(v->'payment',array['method','status'])) else '{}'::jsonb end
|| case when jsonb_typeof(v->'courier_collection')='object' then jsonb_build_object('courier_collection',core_auth.board_scalars_fixture(v->'courier_collection',array['received','amount','received_at'])) else '{}'::jsonb end
|| case when jsonb_typeof(v->'delivery_eta')='object' then jsonb_build_object('delivery_eta',core_auth.board_scalars_fixture(v->'delivery_eta',array['latest_at','earliest_at','min_minutes','max_minutes'])) else '{}'::jsonb end
|| jsonb_build_object('items',coalesce((select jsonb_agg(core_auth.board_scalars_fixture(x,array['name','quantity','unit_price','price','total','notes','observation','observacao'])||coalesce((select jsonb_object_agg(k,core_auth.board_modifiers_fixture(x->k)) from unnest(array['modifiers','addons','complements']) k where jsonb_typeof(x->k)='array'),'{}'::jsonb) order by n) from jsonb_array_elements(case when jsonb_typeof(v->'items')='array' then v->'items' else '[]'::jsonb end) with ordinality as i(x,n) where jsonb_typeof(x)='object'),'[]'::jsonb))
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
