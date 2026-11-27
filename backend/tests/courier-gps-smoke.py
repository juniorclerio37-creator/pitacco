# Disposable GPS regression, using the original shift authorization.
import json,urllib.request,urllib.error,subprocess,os,re
assert os.environ.get('APP_ENV')=='testing' and os.environ.get('GITHUB_ACTIONS')=='true'
def sql(query):
    return subprocess.check_output(['psql','-q','-h','127.0.0.1','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atc',query],env={**os.environ,'PGPASSWORD':'isolated-ci-password'},text=True).strip()
def mint():
    out=sql("""begin; set local role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"97000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"97000000-0000-0000-0000-000000000003"}',true);
select public.pitacco_courier_background_gps_start(); commit;""")
    token=out.splitlines()[-1]
    assert re.fullmatch('[a-f0-9]{64}',token),'original mint did not return a valid capability'
    return token
def call(body,expected):
    req=urllib.request.Request('http://127.0.0.1:8088/api/v1/courier/gps',method='POST',headers={'Accept':'application/json','Content-Type':'application/json'},data=json.dumps(body).encode())
    try:res=urllib.request.urlopen(req,timeout=12)
    except urllib.error.HTTPError as e:res=e
    with res:
        assert res.status==expected,(res.status,expected)
        data=json.loads(res.read())
        assert body.get('p_token','not-present') not in json.dumps(data)
        return data
token=mint()
body={'p_token':token,'p_lat':-22.851234,'p_lng':-43.452894,'p_accuracy_m':20}
call(body|{'p_token':'0'*64},403)
call(body|{'p_lat':90.1},422)
call(body|{'p_accuracy_m':101},422)
call(body|{'courier_id':'97000000-0000-0000-0000-000000000002'},422)
# Token-scoped customer tracking observes the same synthetic courier position.
sql("""insert into public.orders(id,store_id,channel,gross,source,status) values
('97000000-0000-0000-0000-000000000004','91000000-0000-0000-0000-000000000002','Delivery próprio',25,'proprio','accepted'),
('97000000-0000-0000-0000-000000000005','91000000-0000-0000-0000-000000000002','Delivery próprio',25,'proprio','accepted');
insert into public.public_checkouts(order_id,store_id,request_id,payload,phone,tracking_token) values
('97000000-0000-0000-0000-000000000004','91000000-0000-0000-0000-000000000002','97000000-0000-0000-0000-000000000006','{"fulfillment":"delivery","customer":"Cliente GPS Fixture"}','21988888182','97000000-0000-0000-0000-000000000007');
insert into public.deliveries(id,store_id,order_id,courier_id,customer_name,address,status,logistics_provider,collected_at) values
('97000000-0000-0000-0000-000000000008','91000000-0000-0000-0000-000000000002','97000000-0000-0000-0000-000000000004','97000000-0000-0000-0000-000000000002','Cliente GPS Fixture','Synthetic address A','atribuida','loja',null);""")
def track():
    req=urllib.request.Request('http://127.0.0.1:8088/api/v1/public/orders/tracking',method='POST',headers={'Accept':'application/json','Content-Type':'application/json'},data=json.dumps({'tracking_token':'97000000-0000-0000-0000-000000000007'}).encode())
    with urllib.request.urlopen(req,timeout=12) as res:
        assert res.status==200 and 'no-store' in res.headers.get('Cache-Control','')
        return json.loads(res.read())['data']
assert track().get('courier_position') is None
sql("update public.deliveries set status='retirada',collected_at=now() where id='97000000-0000-0000-0000-000000000008'")
first=call(body,200)['data']['observed_at']
assert first
assert sql("select latitude from public.courier_positions where courier_id='97000000-0000-0000-0000-000000000002'")=='-22.851234'
motion=call(body|{'p_motion_state':'moving','p_motion_confidence':90,'p_speed_mps':3},200)
assert motion['data']['observed_at']==first
assert sql("select motion_state from public.courier_positions where courier_id='97000000-0000-0000-0000-000000000002'")=='moving'
call(body|{'p_motion_state':'moving','p_motion_confidence':101},422)
tracking=track()
position=tracking['courier_position']
assert position['state']=='available' and float(position['latitude'])==-22.851 and float(position['longitude'])==-43.453
assert 'courier_id' not in position and 'address' not in tracking
sql("""insert into public.deliveries(id,store_id,order_id,courier_id,customer_name,address,status,logistics_provider,collected_at,arrived_at)
values ('97000000-0000-0000-0000-000000000009','91000000-0000-0000-0000-000000000002','97000000-0000-0000-0000-000000000005','97000000-0000-0000-0000-000000000002','Other Fixture','Synthetic address B','retirada','loja',now(),now());""")
grouped=track()
assert grouped['courier_position']['state']=='multiple_stops'
assert grouped['courier_position']['another_arrived'] is True
assert float(grouped['courier_position']['latitude'])==-22.85
assert 'Synthetic address B' not in json.dumps(grouped)
sql("update public.deliveries set status='entregue',delivery_code_verified_at=now() where id='97000000-0000-0000-0000-000000000009'")
sql("update public.courier_positions set observed_at=now()-interval '2 minutes' where courier_id='97000000-0000-0000-0000-000000000002'")
assert track()['courier_position']=={'state':'awaiting_gps'}
call(body,200)
assert track()['courier_position']['state']=='available'
sql("update public.deliveries set status='entregue',arrived_at=now(),delivery_code_verified_at=now() where id='97000000-0000-0000-0000-000000000008'")
assert track().get('courier_position') is None
print('PASS: actual Laravel GPS to customer tracking, no pre-dispatch GPS, approximate position, grouped privacy, stale and completed delivery')
sql("update public.couriers set available=false where id='97000000-0000-0000-0000-000000000002'")
call(body,403)
sql("update public.couriers set available=true where id='97000000-0000-0000-0000-000000000002'")
call(body,403)
fresh=mint()
assert fresh!=token
call(body|{'p_token':fresh},200)
sql("delete from auth.sessions where id='97000000-0000-0000-0000-000000000003'")
call(body|{'p_token':fresh},403)
print('PASS: original shift GPS capability, coordinates, motion, invalid input, offline revocation, reactivation and revoked session')
