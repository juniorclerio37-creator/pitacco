# CI only. No provider payment or real accounts.
import json,urllib.request,urllib.error,subprocess,os,uuid
assert os.environ.get('APP_ENV')=='testing' and os.environ.get('GITHUB_ACTIONS')=='true'
base='http://127.0.0.1:8090/api/v1'
def call(path,expected,body,token=None):
    headers={'Accept':'application/json','Content-Type':'application/json'}
    if token:headers['Authorization']='Bearer '+token
    req=urllib.request.Request(base+path,method='POST',headers=headers,data=json.dumps(body).encode())
    try:res=urllib.request.urlopen(req,timeout=12)
    except urllib.error.HTTPError as e:res=e
    with res:
        assert res.status==expected,(path,res.status,expected)
        return json.loads(res.read())
def sql(query):
    return subprocess.check_output(['psql','-h','127.0.0.1','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atc',query],env={**os.environ,'PGPASSWORD':'isolated-ci-password'},text=True).strip()
def login(email):
    return call('/auth/login',200,{'email':email,'password':'fixture-only-password'})['access_token']
d='/courier/delivery'
owner=login('alice@example.test')
courier=login('courier@example.test')
gps=call('/courier/shift',200,{'action':'start_gps'},courier)['data']['gps_token']
s='20000000-0000-4000-8000-000000000001'
one='98000000-0000-0000-0000-000000000041'
two='98000000-0000-0000-0000-000000000042'
cid='98000000-0000-0000-0000-000000000002'
p='/stores/'+s+'/dispatch/group'
body={'courier_id':cid,'delivery_ids':[one,two]}
# Exercise individual assignment, safe reassignment and the automatic hold before grouping.
individual='/stores/'+s+'/dispatch/deliveries/'+one
second='98000000-0000-0000-0000-000000000052'
assign={'action':'assign','courier_id':cid}
def read_logistics(resource,status=200,token=None,store=s,query=''):
    headers={'Accept':'application/json'}
    if token:headers['Authorization']='Bearer '+token
    req=urllib.request.Request('http://127.0.0.1:8094/api/v1/stores/'+store+'/own-logistics/'+resource+query,headers=headers)
    try:res=urllib.request.urlopen(req,timeout=10)
    except urllib.error.HTTPError as e:res=e
    with res:
        assert res.status==status,(resource,res.status,status)
        return json.loads(res.read())
read_logistics('deliveries',401)
read_logistics('deliveries',404,courier)
read_logistics('couriers',404,owner,'20000000-0000-4000-8000-000000000002')
read_logistics('positions',404,courier)
read_logistics('deliveries',422,owner,query='?limit=101')
rows=read_logistics('deliveries',token=owner)['data']
assert all(row['store_id']==s and row['source']=='proprio' and row['logistics_provider']=='loja' for row in rows)
assert {one,two} <= {row['id'] for row in rows}
assert all(set(row)<={'id','store_id','order_id','customer_name','address','status','source','logistics_provider','courier_id','batch_id','manual_dispatch_hold','collected_at','arrived_at','capacity_released_at','latitude','longitude','deliver_by'} for row in rows)
assert len(read_logistics('deliveries',token=owner,query='?limit=1')['data'])==1
fleet=read_logistics('couriers',token=owner)['data']
assert {cid,second} <= {row['id'] for row in fleet}
assert all(set(row)=={'id','store_id','name','fleet_type','active','available'} and row['store_id']==s and row['fleet_type']=='propria' for row in fleet)
positions=read_logistics('positions',token=owner)['data']
assert any(row['courier_id']==cid for row in positions)
assert all(set(row)=={'courier_id','latitude','longitude','observed_at','accuracy_m'} for row in positions)
print('PASS: own board logistics read, original scoped courier and GPS queries, minimal fields, pagination and tenant isolation')
# Exercise the separate iFood own-fleet path before the original grouping suite.
market_order='98000000-0000-0000-0000-000000000071'
market_delivery='98000000-0000-0000-0000-000000000072'
market_path='/stores/'+s+'/dispatch/ifood-deliveries/'+market_delivery
sql("insert into public.orders(id,store_id,channel,gross,source,status,preparation_status,receipt) values('"+market_order+"','"+s+"','iFood',25,'ifood','accepted','preparing','{\"ifood_status\":\"CONFIRMED\",\"logistics\":\"loja\"}')")
sql("insert into public.deliveries(id,store_id,order_id,customer_name,address,status,source,logistics_provider) values('"+market_delivery+"','"+s+"','"+market_order+"','Cliente Fixture','Rua Fixture','pendente','ifood','loja')")
saved_base=base
base='http://127.0.0.1:8094/api/v1'
market_assign={'action':'assign','courier_id':second}
call(market_path,401,market_assign)
call(market_path,404,market_assign,courier)
call(market_path,409,market_assign,owner)
sql("update public.orders set preparation_status='ready' where id='"+market_order+"'")
call(market_path,403,market_assign|{'courier_id':str(uuid.uuid4())},owner)
call(market_path.replace(market_delivery,one),403,market_assign,owner)
sql("update public.deliveries set external_delivery_status='SHIPPING_REQUESTING' where id='"+market_delivery+"'")
call(market_path,409,market_assign,owner)
sql("update public.deliveries set external_delivery_status=null where id='"+market_delivery+"'")
mr=call(market_path,200,market_assign,owner)['data']['route_id']
assert call(market_path,200,market_assign,owner)['data']['route_id']==mr
mrow=next(x for x in read_logistics('ifood-deliveries',token=owner)['data'] if x['id']==market_delivery)
assert mrow['courier_id']==second and mrow['batch_id']==mr and mrow['status']=='atribuida'
assert 'customer_name' not in mrow and 'address' not in mrow
assert all(x['source']=='ifood' and x['store_id']==s for x in read_logistics('ifood-deliveries',token=owner)['data'])
assert sql("select receipt->>'ifood_status' from public.orders where id='"+market_order+"'")=='CONFIRMED'
assert sql("select count(*) from pitacco_private.ifood_courier_dispatch where delivery_id='"+market_delivery+"'")=='0'
call(market_path,200,{'action':'remove','expected_courier_id':second},owner)
assert sql("select (courier_id is null and manual_dispatch_hold)::text from public.deliveries where id='"+market_delivery+"'")=='true'
# Mixed route: distinct own fixture, same courier, no outbound provider calls.
mixed_order='98000000-0000-0000-0000-000000000073'
mixed_delivery='98000000-0000-0000-0000-000000000074'
mixed_path='/stores/'+s+'/dispatch/mixed-group'
mixed_body={'courier_id':second,'delivery_ids':[mixed_delivery,market_delivery]}
sql("insert into public.orders(id,store_id,channel,gross,source,status,preparation_status,receipt) values('"+mixed_order+"','"+s+"','Delivery próprio',25,'proprio','accepted','ready','{}')")
sql("insert into public.deliveries(id,store_id,order_id,customer_name,address,status,source,logistics_provider) values('"+mixed_delivery+"','"+s+"','"+mixed_order+"','Cliente Fixture','Rua Fixture','pendente','proprio','loja')")
call(mixed_path,401,mixed_body)
call(mixed_path,404,mixed_body,courier)
call(mixed_path.replace(s,'20000000-0000-4000-8000-000000000002'),404,mixed_body,owner)
call(mixed_path,422,mixed_body|{'delivery_ids':[mixed_delivery,mixed_delivery]},owner)
call(mixed_path,403,mixed_body|{'delivery_ids':[mixed_delivery,str(uuid.uuid4())]},owner)
call(mixed_path,409,mixed_body|{'delivery_ids':[mixed_delivery,one]},owner)
sql("insert into public.courier_positions(courier_id,latitude,longitude,accuracy_m,observed_at) values('"+second+"',-22.85,-43.45,15,now()-interval '3 minutes') on conflict(courier_id) do update set observed_at=excluded.observed_at")
call(mixed_path,409,mixed_body,owner)
sql("update public.courier_positions set observed_at=now() where courier_id='"+second+"'")
sql("update public.orders set preparation_status='preparing' where id='"+market_order+"'")
call(mixed_path,409,mixed_body,owner)
assert sql("select count(*) from public.deliveries where id in ('"+mixed_delivery+"','"+market_delivery+"') and courier_id is null and batch_id is null and status='pendente'")=='2'
sql("update public.orders set preparation_status='ready' where id='"+market_order+"'")
sql("update public.deliveries set external_delivery_status='SHIPPING_UNCERTAIN' where id='"+market_delivery+"'")
call(mixed_path,409,mixed_body,owner)
sql("update public.deliveries set external_delivery_status=null where id='"+market_delivery+"'")
# The latest production rule explicitly permits a manual override of the
# automatic capacity target (20261126181849). Verify that audit records it.
sql("update public.stores set max_orders_per_trip=1 where id='"+s+"'")
mixed_route=call(mixed_path,200,mixed_body,owner)['data']['route_id']
assert sql("select count(*) from public.operation_audit where action='route_manual_assigned' and details->>'route'='"+mixed_route+"' and details->>'manual_override'='true' and details->>'configured_capacity'='1'")=='2'
assert sql("select max((details->>'route_load')::int) from public.operation_audit where action='route_manual_assigned' and details->>'route'='"+mixed_route+"'")=='2'
sql("update public.stores set max_orders_per_trip=2 where id='"+s+"'")
assert sql("select count(*) from public.deliveries where batch_id='"+mixed_route+"' and courier_id='"+second+"' and status='atribuida'")=='2'
assert sql("select receipt->>'ifood_status' from public.orders where id='"+market_order+"'")=='CONFIRMED'
assert sql("select count(*) from pitacco_private.ifood_courier_dispatch where delivery_id='"+market_delivery+"'")=='0'
call(mixed_path,409,mixed_body,owner)
assert sql("select (departed_at is null)::text from public.delivery_batches where id='"+mixed_route+"'")=='true'
# Release the synthetic mixed route using the already validated removal RPCs.
call(market_path,200,{'action':'remove','expected_courier_id':second},owner)
call('/stores/'+s+'/dispatch/deliveries/'+mixed_delivery,200,{'action':'remove','expected_courier_id':second},owner)
assert sql("select (completed_at is not null)::text from public.delivery_batches where id='"+mixed_route+"'")=='true'
# Reassign the two synthetic stops to the authenticated courier, now test local
# collection and departure separately from the provider.
base='http://127.0.0.1:8095/api/v1'
sql("update public.courier_positions set observed_at=now() where courier_id='"+cid+"'")
route2=call(mixed_path,200,mixed_body|{'courier_id':cid},owner)['data']['route_id']
driver_route='/courier/ifood-route'
depart={'action':'depart_group','route_id':route2}
collect_market={'action':'collect','delivery_id':market_delivery}
call(driver_route,401,depart)
call(driver_route,403,depart,owner)
call(driver_route,403,depart|{'route_id':str(uuid.uuid4())},courier)
call(driver_route,422,depart|{'code':'1234'},courier)
call(d,403,depart,courier)
call(driver_route,409,depart,courier)
call(driver_route,200,collect_market,courier)
call(driver_route,200,collect_market,courier)
assert sql("select count(*) from public.operation_audit where action='courier_collected' and details->>'delivery'='"+market_delivery+"'")=='1'
assert sql("select count(*) from pitacco_private.ifood_courier_dispatch where delivery_id='"+market_delivery+"'")=='0'
call(driver_route,409,depart,courier)
call(driver_route,200,{'action':'collect','delivery_id':mixed_delivery},courier)
assert call(driver_route,200,depart,courier)['data']=={'departed':True,'pending_ifood_dispatch':[market_delivery]}
assert call(driver_route,200,depart,courier)['data']=={'departed':True,'pending_ifood_dispatch':[market_delivery]}
assert sql("select count(*) from public.deliveries where batch_id='"+route2+"' and status='retirada'")=='2'
assert sql("select count(*) from public.operation_audit where action='route_departed' and details->>'route'='"+route2+"'")=='1'
assert sql("select receipt->>'ifood_status' from public.orders where id='"+market_order+"'")=='CONFIRMED'
assert sql("select count(*) from pitacco_private.ifood_courier_dispatch where delivery_id='"+market_delivery+"'")=='0'
call(driver_route,409,collect_market,courier)
# Local arrival, COD confirmation and provider verification eligibility.
arrival={'action':'arrive','delivery_id':market_delivery}
eligibility={'action':'verify_ready','delivery_id':market_delivery}
payment={'action':'confirm_payment','delivery_id':market_delivery}
call(driver_route,403,arrival,owner)
call(driver_route,403,arrival|{'delivery_id':mixed_delivery},courier)
call(driver_route,409,eligibility,courier)
call(driver_route,409,payment,courier)
reconcile={'action':'reconcile','delivery_id':market_delivery}
call(driver_route,409,reconcile,courier)
sql("update public.orders set receipt=receipt||'{\"payment\":\"dinheiro\",\"payment_status\":\"pending\"}'::jsonb where id='"+market_order+"'")
arrived=call(driver_route,200,arrival,courier)['data']
assert arrived['arrived_at'] and arrived['provider_state']=='pending' and arrived['dispatch_confirmed'] is False
assert call(driver_route,200,arrival,courier)['data']==arrived
assert sql("select count(*) from public.operation_audit where action='courier_arrived' and details->>'delivery'='"+market_delivery+"'")=='1'
call(driver_route,409,eligibility,courier)
call(driver_route,409,reconcile,courier)
paid=call(driver_route,200,payment,courier)['data']
assert paid['state']=='paid' and paid['received_by_courier'] is True
assert call(driver_route,200,payment,courier)['data']==paid
assert sql("select count(*) from public.operation_audit where action='courier_payment_received' and details->>'delivery'='"+market_delivery+"'")=='1'
assert call(driver_route,200,eligibility,courier)['data']=={'eligible':True,'delivered':False}
# Synthetic official event state only; no provider network or verified PIN.
sql("update public.orders set receipt=receipt||'{\"ifood_status\":\"DISPATCHED\"}'::jsonb where id='"+market_order+"'")
assert call(driver_route,200,arrival,courier)['data']['dispatch_confirmed'] is True
assert sql("select (status='retirada' and delivery_code_verified_at is null)::text from public.deliveries where id='"+market_delivery+"'")=='true'
print('PASS: local iFood arrival, official dispatch gate, payment collection, repeat and pre-verification without PIN or provider mutation')
# Reconciliation: synthesize evidence only in the disposable CI database.
# The original private event table is never writable through the API.
call(driver_route,401,reconcile)
call(driver_route,403,reconcile,owner)
call(driver_route,403,reconcile|{'delivery_id':mixed_delivery},courier)
call(driver_route,422,reconcile|{'confirmed':True},courier)
pending={'confirmed':False,'pending':True}
assert call(driver_route,200,reconcile,courier)['data']==pending
sql("update public.orders set receipt=receipt||'{\"ifood_status\":\"CONCLUDED\"}'::jsonb where id='"+market_order+"'")
assert call(driver_route,200,reconcile,courier)['data']==pending
merchant='98000000-0000-0000-0000-000000000075'
other_merchant='98000000-0000-0000-0000-000000000076'
external='98000000-0000-0000-0000-000000000077'
event='98000000-0000-0000-0000-000000000078'
sql("insert into pitacco_private.ifood_merchants(merchant_id,store_id,test_only,enabled) values ('"+merchant+"','"+s+"',true,true),('"+other_merchant+"','20000000-0000-4000-8000-000000000002',true,true)")
sql("insert into pitacco_private.ifood_order_links(external_id,order_id,merchant_id,state_rank,event_at) values('"+external+"','"+market_order+"','"+merchant+"',5,now())")
sql("insert into pitacco_private.ifood_events(id,merchant_id,order_id,code,event_at,done_at) values('"+event+"','"+other_merchant+"','"+external+"','CONCLUDED',now(),now())")
assert call(driver_route,200,reconcile,courier)['data']==pending
sql("update pitacco_private.ifood_events set merchant_id='"+merchant+"',done_at=null where id='"+event+"'")
assert call(driver_route,200,reconcile,courier)['data']==pending
# Isolate the explicit reconciliation RPC from original automatic event triggers.
# CI-only synthetic evidence insertion; all triggers reenabled in same transaction.
sql("begin; alter table pitacco_private.ifood_events disable trigger user; update pitacco_private.ifood_events set done_at=now(),event_at=(select arrived_at-interval '1 second' from public.deliveries where id='"+market_delivery+"') where id='"+event+"'; alter table pitacco_private.ifood_events enable trigger user; commit;")
evidence=sql("select jsonb_build_object('status',d.status,'arrived_at',d.arrived_at,'event_at',e.event_at,'done_at',e.done_at,'old_event',e.event_at<d.arrived_at)::text from public.deliveries d join pitacco_private.ifood_events e on e.id='"+event+"' where d.id='"+market_delivery+"'")
assert json.loads(evidence)['old_event'] is True,evidence
assert json.loads(evidence)['status']=='retirada',evidence
reconciled=call(driver_route,200,reconcile,courier)['data']
assert reconciled==pending,(reconciled,evidence)
assert sql("select status from public.deliveries where id='"+market_delivery+"'")=='retirada'
sql("begin; alter table pitacco_private.ifood_events disable trigger user; update pitacco_private.ifood_events set event_at=now() where id='"+event+"'; alter table pitacco_private.ifood_events enable trigger user; commit;")
assert call(driver_route,200,reconcile,courier)['data']=={'confirmed':True,'already':False}
assert call(driver_route,200,reconcile,courier)['data']=={'confirmed':True,'already':True}
assert call(driver_route,200,eligibility,courier)['data']=={'eligible':False,'delivered':True}
assert sql("select (d.status='entregue' and d.delivery_code_verified_at=e.event_at)::text from public.deliveries d join pitacco_private.ifood_events e on e.id='"+event+"' where d.id='"+market_delivery+"'")=='true'
assert sql("select count(*) from public.operation_audit where action='ifood_external_delivery_reconciled' and details->>'delivery'='"+market_delivery+"'")=='1'
assert sql("select count(*) from public.operation_audit where action='ifood_code_verified' and order_id='"+market_order+"'")=='0'
print('PASS: original official CONCLUDED reconciliation, exact merchant, processed event, arrival timestamp, no fictitious PIN, replay and authorization')
# Dispose of this synthetic route only, simulating official cancellation locally
# for the independent test; no provider communication.
sql("update public.orders set receipt=receipt||'{\"ifood_status\":\"CANCELLED\"}'::jsonb,status='cancelled' where id='"+market_order+"'")
sql("update public.orders set status='cancelled' where id='"+mixed_order+"'")
sql("update public.courier_positions set observed_at=now()-interval '3 minutes' where courier_id='"+cid+"'")
base='http://127.0.0.1:8094/api/v1'
print('PASS: mixed route collection and local departure, replay, all stops collected, pending iFood dispatch only')
print('PASS: mixed local route, readiness, stale GPS, audited manual capacity override, Shipping hold, atomic rejection, no official dispatch')
# End this independent synthetic fixture so the original scheduler's fail-closed
# marketplace scope and the own-order grouping tests are unaffected.
sql("update public.orders set status='cancelled' where id='"+market_order+"'")
base=saved_base
print('PASS: iFood own-fleet assignment, readiness, provider hold, replay, scoped read and removal without provider dispatch')
call(individual,401,assign)
call(individual,404,assign,courier)
call(individual.replace(s,'20000000-0000-4000-8000-000000000002'),404,assign,owner)
call(individual,403,assign|{'courier_id':str(uuid.uuid4())},owner)
call(individual,422,{'action':'remove'},owner)
old=str(uuid.UUID(call(individual,200,assign,owner)['data']['route_id']))
assert call(individual,200,assign,owner)['data']['route_id']==old
assert sql("select count(*) from public.operation_audit where action='route_manual_assigned' and details->>'delivery'='"+one+"'")=='1'
call(individual,409,{'action':'remove','expected_courier_id':second},owner)
new=str(uuid.UUID(call(individual,200,{'action':'reassign','expected_courier_id':cid,'courier_id':second},owner)['data']['route_id']))
assert new!=old
assert sql("select (completed_at is not null)::text from public.delivery_batches where id='"+old+"'")=='true'
assert sql("select courier_id::text from public.deliveries where id='"+one+"'")==second
assert next(row for row in read_logistics('deliveries',token=owner)['data'] if row['id']==one)['courier_id']==second
assert call(individual,200,{'action':'remove','expected_courier_id':second},owner)['data']['route_id'] is None
assert sql("select (manual_dispatch_hold and courier_id is null and batch_id is null and status='pendente')::text from public.deliveries where id='"+one+"'")=='true'
assert sql("select (completed_at is not null)::text from public.delivery_batches where id='"+new+"'")=='true'
call(individual,200,{'action':'resume'},owner)
assert sql("select manual_dispatch_hold::text from public.deliveries where id='"+one+"'")=='false'
assert sql("select status from public.orders where id='98000000-0000-0000-0000-000000000031'")=='accepted'
print('PASS: original individual assignment, repeated request, stale expected courier, reassignment, remove and automatic resume')

# Original geographic scheduler, in an isolated transaction. Rollback leaves the
# two deliveries exactly as the following HTTP manual grouping scenario expects.
sql("""
begin;
do $geo$
declare
 s uuid:='20000000-0000-4000-8000-000000000001';
 a uuid:='98000000-0000-0000-0000-000000000041';
 b uuid:='98000000-0000-0000-0000-000000000042';
 c uuid:='98000000-0000-0000-0000-000000000002';
 route uuid;
begin
 -- Isolate existing synthetic checkout records in this disposable database.
 update public.deliveries set manual_dispatch_hold=true where store_id=s and id not in (a,b) and status='pendente';
 update public.couriers set available=false where store_id=s and id<>c;
 update public.couriers set available=true where id=c;
 update public.stores set dispatch_mode='automatico',latitude=-22.85,longitude=-43.45,max_orders_per_trip=2 where id=s;
 update public.deliveries set latitude=-22.84,longitude=-43.45,deliver_by=now()+interval '45 minutes',manual_dispatch_hold=true where id=a;
 update public.deliveries set latitude=-22.86,longitude=-43.45,deliver_by=now()+interval '60 minutes',manual_dispatch_hold=false where id=b;
 update public.courier_positions set latitude=-22.85,longitude=-43.45,observed_at=now() where courier_id=c;
 if pitacco_private.group_auto_one(s) is not null then raise exception 'Held or preparing delivery was assigned';end if;
 update public.deliveries set manual_dispatch_hold=false where id=a;
 update public.courier_positions set observed_at=now()-interval '3 minutes' where courier_id=c;
 if pitacco_private.group_auto_one(s) is not null then raise exception 'Stale GPS was accepted';end if;
 update public.courier_positions set observed_at=now() where courier_id=c;
 route:=pitacco_private.group_auto_one(s);
 if route is null or not exists(select 1 from public.deliveries where id=a and courier_id=c and batch_id=route and status='atribuida') then raise exception 'Ready delivery was not assigned by original scheduler';end if;
 update public.orders set preparation_status='ready' where id='98000000-0000-0000-0000-000000000032';
 if pitacco_private.group_auto_one(s) is not null then raise exception 'Opposite destination was grouped';end if;
 update public.deliveries set latitude=-22.839,longitude=-43.45 where id=b;
 if pitacco_private.group_auto_one(s) is distinct from route then raise exception 'Compatible destination did not join existing route';end if;
 if (select count(*) from public.deliveries where id in (a,b) and batch_id=route and courier_id=c and status='atribuida')<>2 then raise exception 'Geographic grouping state mismatch';end if;
 if pitacco_private.group_auto_one(s) is not null then raise exception 'Repeated scheduler created an additional assignment';end if;
 if (select count(*) from public.operation_audit where action='route_auto_assigned' and details->>'delivery' in (a::text,b::text))<>2 then raise exception 'Automatic assignment audit mismatch';end if;
 if (select count(*) from public.operation_audit where action='route_geographic_auto_validation' and details->>'delivery' in (a::text,b::text))<>2 then raise exception 'Geographic evidence audit mismatch';end if;
end $geo$;
rollback;
""")
assert sql("select count(*) from public.deliveries where id in ('"+one+"','"+two+"') and courier_id is null and batch_id is null and status='pendente'")=='2'
print('PASS: original geographic scheduler respects manual hold, preparation, stale GPS, direction, compatible route and duplicate prevention; rolled back')
# Rehearse mixed automatic grouping against the unchanged original scheduler.
# Disposable transaction only; do not widen the live experimental CLI scope.
sql("""
begin;
do $mixed_geo$
declare
 s uuid:='20000000-0000-4000-8000-000000000001';
 a uuid:='98000000-0000-0000-0000-000000000041';
 m uuid:='98000000-0000-0000-0000-000000000081';
 mo uuid:='98000000-0000-0000-0000-000000000082';
 c uuid:='98000000-0000-0000-0000-000000000002';
 route uuid;
begin
 update public.deliveries set manual_dispatch_hold=true where store_id=s and status='pendente';
 update public.couriers set available=(id=c) where store_id=s;
 update public.stores set dispatch_mode='automatico',latitude=-22.85,longitude=-43.45,max_orders_per_trip=2 where id=s;
 update public.deliveries set latitude=-22.84,longitude=-43.45,deliver_by=now()+interval '45 minutes',manual_dispatch_hold=false where id=a;
 update public.courier_positions set latitude=-22.85,longitude=-43.45,observed_at=now() where courier_id=c;
 insert into public.orders(id,store_id,channel,gross,source,status,preparation_status,receipt)
 values(mo,s,'iFood',25,'ifood','accepted','ready','{"ifood_status":"CONFIRMED","logistics":"loja","ifood_test":true}');
 insert into public.deliveries(id,store_id,order_id,customer_name,address,status,source,logistics_provider,latitude,longitude,deliver_by,manual_dispatch_hold)
 values(m,s,mo,'Cliente Fixture','Rua Fixture','pendente','ifood','loja',-22.86,-43.45,now()+interval '60 minutes',true);
 route:=pitacco_private.group_auto_one(s);
 if route is null or not exists(select 1 from public.deliveries where id=a and batch_id=route and courier_id=c) then raise exception 'Own route was not assigned';end if;
 update public.deliveries set manual_dispatch_hold=false where id=m;
 if pitacco_private.group_auto_one(s) is not null then raise exception 'Opposite marketplace destination grouped';end if;
 update public.deliveries set latitude=-22.839,longitude=-43.45,external_delivery_status='SHIPPING_UNCERTAIN' where id=m;
 if pitacco_private.group_auto_one(s) is not null then raise exception 'Shipping uncertain delivery assigned';end if;
 update public.deliveries set external_delivery_status=null where id=m;
 if pitacco_private.group_auto_one(s) is distinct from route then raise exception 'Compatible iFood stop did not join own route';end if;
 if (select count(*) from public.deliveries where id in (a,m) and batch_id=route and status='atribuida')<>2 then raise exception 'Mixed route mismatch';end if;
 if pitacco_private.group_auto_one(s) is not null then raise exception 'Capacity or replay failed';end if;
 if exists(select 1 from pitacco_private.ifood_courier_dispatch where delivery_id=m) then raise exception 'Unexpected provider dispatch';end if;
 if (select receipt->>'ifood_status' from public.orders where id=mo)<>'CONFIRMED' then raise exception 'Official status mutated';end if;
end $mixed_geo$;
rollback;
""")
print('PASS: isolated original mixed geographic grouping rehearsal, opposite direction, Shipping hold, capacity and no provider dispatch')

call(p,401,body)
call(p,404,body,courier)
call(p.replace(s,'20000000-0000-4000-8000-000000000002'),404,body,owner)
call(p,422,body|{'delivery_ids':[one,one]},owner)
call(p,403,body|{'delivery_ids':[one,str(uuid.uuid4())]},owner)
call(p,409,body,owner) # stale GPS
sql("update public.courier_positions set observed_at=now() where courier_id='"+cid+"'")
call(p,409,body,owner) # second order still preparing; first assignment rolls back
assert sql("select count(*) from public.deliveries where id in ('"+one+"','"+two+"') and courier_id is null and batch_id is null and status='pendente'")=='2'
sql("update public.orders set preparation_status='ready' where id='98000000-0000-0000-0000-000000000032'")
route=str(uuid.UUID(call(p,200,body,owner)['data']['route_id']))
assert sql("select count(*) from public.deliveries where batch_id='"+route+"' and status='atribuida'")=='2'
call(p,409,body,owner)
print('PASS: merchant assignment with scoped store, fresh GPS, atomic rollback, capacity and original route creation')
group={'action':'depart_group','route_id':route}
call(d,403,group,owner)
call(d,401,group,gps)
call(d,403,group|{'route_id':str(uuid.uuid4())},courier)
call(d,422,group|{'delivery_id':one},courier)
call(d,409,group,courier)
call(d,200,{'action':'collect','delivery_id':one},courier)
call(d,409,{'action':'depart','delivery_id':one},courier)
call(d,409,group,courier)
assert sql("select count(*) from public.deliveries where batch_id='"+route+"' and status='retirada'")=='0'
assert sql("select (departed_at is null)::text from public.delivery_batches where id='"+route+"'")=='true'
call(d,200,{'action':'collect','delivery_id':two},courier)
assert call(d,200,group,courier)['data']=={'departed':True}
assert call(d,200,group,courier)['data']=={'departed':True}
assert sql("select count(*) from public.deliveries where batch_id='"+route+"' and status='retirada'")=='2'
assert sql("select count(*) from public.operation_audit where action='route_departed' and details->>'route'='"+route+"'")=='1'
call(d,409,{'action':'collect','delivery_id':one},courier)
call(individual,409,{'action':'remove','expected_courier_id':cid},owner)
print('PASS: original grouped departure requires every collection and commits both deliveries together')
call('/auth/logout',200,{},courier)
call(d,401,group,courier)

# Restore the revoked fixture state and prove the dispatch endpoint respects it.
sql("update core_auth.memberships set active=false where user_id='10000000-0000-4000-8000-000000000001' and store_id='"+s+"' and role='owner'")
call(p,404,body,owner)
call(individual,404,{'action':'remove','expected_courier_id':cid},owner)
assert sql("select count(*) from public.deliveries where batch_id='"+route+"' and status='retirada'")=='2'
read_logistics('deliveries',404,owner)
read_logistics('couriers',404,owner)
read_logistics('positions',404,owner)
read_logistics('ifood-deliveries',404,owner)
base='http://127.0.0.1:8094/api/v1'
call(market_path,404,market_assign,owner)
call(mixed_path,404,mixed_body,owner)
base=saved_base
print('PASS: merchant dispatch rejects revoked membership without modifying the existing route')

# CLI worker: a fresh synthetic order and the second courier, independent of
# the departed grouped route above. The database is disposable.
def tick(enabled):
    env={**os.environ,'PITACCO_AUTO_DISPATCH_ENABLED':'true' if enabled else 'false',
         'CORE_AUTO_DISPATCH_DB_USERNAME':'pitacco_core_auto_dispatch',
         'CORE_AUTO_DISPATCH_DB_PASSWORD':'ci-auto-dispatch-only'}
    return subprocess.run(['php','artisan','pitacco:dispatch-tick'],env=env,text=True,capture_output=True,timeout=15)
worker_order='98000000-0000-0000-0000-000000000061'
worker_delivery='98000000-0000-0000-0000-000000000062'
sql("update public.deliveries set manual_dispatch_hold=true where store_id='"+s+"' and status='pendente'")
sql("update public.couriers set available=false where store_id='"+s+"'")
sql("update public.couriers set available=true where id='"+second+"'")
sql("update public.stores set dispatch_mode='automatico',latitude=-22.85,longitude=-43.45 where id='"+s+"'")
sql("insert into public.courier_positions(courier_id,latitude,longitude,accuracy_m,observed_at) values('"+second+"',-22.85,-43.45,15,now()) on conflict(courier_id) do update set observed_at=excluded.observed_at")
sql("insert into public.orders(id,store_id,channel,gross,source,status,preparation_status,receipt) values('"+worker_order+"','"+s+"','Delivery próprio',25,'proprio','accepted','ready','{}')")
sql("insert into public.deliveries(id,store_id,order_id,customer_name,address,status,source,logistics_provider,latitude,longitude,deliver_by,manual_dispatch_hold) values('"+worker_delivery+"','"+s+"','"+worker_order+"','Cliente Fixture','Rua Fixture','pendente','proprio','loja',-22.84,-43.45,now()+interval '45 minutes',true)")
def worker_state():
    return sql("select (status='pendente' and courier_id is null and batch_id is null)::text from public.deliveries where id='"+worker_delivery+"'")
assert tick(False).returncode!=0
assert worker_state()=='true'
held=tick(True)
assert held.returncode==0 and 'assigned=0' in held.stdout,(held.returncode,held.stdout)
sql("update public.deliveries set manual_dispatch_hold=false where id='"+worker_delivery+"'")
assigned=tick(True)
assert assigned.returncode==0 and 'assigned=1' in assigned.stdout,(assigned.returncode,assigned.stdout)
assert sql("select (courier_id='"+second+"' and status='atribuida' and batch_id is not null)::text from public.deliveries where id='"+worker_delivery+"'")=='true'
repeat=tick(True)
assert repeat.returncode==0 and 'assigned=0' in repeat.stdout,(repeat.returncode,repeat.stdout)
assert sql("select count(*) from public.operation_audit where action='route_auto_assigned' and details->>'delivery'='"+worker_delivery+"'")=='1'
denied=subprocess.run(['psql','-h','127.0.0.1','-U','pitacco_core_auto_dispatch','-d','postgres','-v','ON_ERROR_STOP=1','-Atc','select * from public.deliveries'],env={**os.environ,'PGPASSWORD':'ci-auto-dispatch-only'},capture_output=True)
assert denied.returncode!=0
print('PASS: isolated Laravel CLI dispatch tick, disabled gate, manual hold, assignment, replay and restricted SQL role')
