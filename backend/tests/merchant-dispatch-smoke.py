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
print('PASS: merchant dispatch rejects revoked membership without modifying the existing route')
