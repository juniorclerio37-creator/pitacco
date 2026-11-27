# CI only. No provider payment or real accounts.
import json,urllib.request,urllib.error,subprocess,os,uuid
assert os.environ.get('APP_ENV')=='testing' and os.environ.get('GITHUB_ACTIONS')=='true'
base='http://127.0.0.1:8089/api/v1'
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
p='/courier/payments'
cards={'action':'cards'}
delivery='98000000-0000-0000-0000-000000000021'
confirm={'action':'confirm','delivery_id':delivery}
call(p,401,cards)
owner=login('alice@example.test')
call(p,403,cards,owner)
courier=login('courier@example.test')
gps=call('/courier/shift',200,{'action':'start_gps'},courier)['data']['gps_token']
call(p,401,confirm,gps)
result={x['delivery_id']:x['payment'] for x in call(p,200,cards,courier)['data']}
assert float(result[delivery]['amount'])==34 and float(result[delivery]['change_due'])==16
assert result[delivery]['state']=='collect'
call(p,422,confirm|{'amount':1},courier)
call(p,403,confirm|{'delivery_id':str(uuid.uuid4())},courier)
call(p,409,confirm,courier)
call(p,409,confirm|{'delivery_id':'98000000-0000-0000-0000-000000000022'},courier)
# Exercise documented arrival SQL under the actual synthetic authenticated session.
# Do not print the bearer, session id, or code. SQL is only a CI harness.
sid=str(uuid.UUID(sql("select id from core_auth.sessions where user_id='98000000-0000-0000-0000-000000000001' and revoked_at is null order by expires_at desc limit 1")))
prefix="begin; set local role authenticated; select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000001',true); select set_config('request.jwt.claims','"+json.dumps({'sub':'98000000-0000-0000-0000-000000000001','role':'authenticated','session_id':sid})+"',true); "
def arrive():
    out=sql(prefix+"select public.pitacco_driver_arrive('"+delivery+"')::text; commit;")
    return next(json.loads(line) for line in out.splitlines() if line.startswith('{') and 'arrived_at' in line)
arrival=arrive()
assert arrival['arrived_at'] and arrival['provider_state']=='local'
assert arrive()==arrival
assert sql("select count(*) from public.operation_audit where order_id='98000000-0000-0000-0000-000000000011' and action='courier_arrived'")=='1'
assert sql("select count(*) from public.public_order_push_events where order_id='98000000-0000-0000-0000-000000000011' and event_key='courier_arrived'")=='1'
assert sql("select status from public.deliveries where id='"+delivery+"'")=='retirada'
paid=call(p,200,confirm,courier)['data']
assert paid['state']=='paid' and paid['received_by_courier'] is True and float(paid['amount'])==34
assert call(p,200,confirm,courier)['data']==paid
assert sql("select count(*) from public.operation_audit where order_id='98000000-0000-0000-0000-000000000011' and action='courier_payment_received'")=='1'
assert sql("select status from public.deliveries where id='"+delivery+"'")=='retirada'
call('/auth/logout',200,{},courier)
call(p,401,confirm,courier)
print('PASS: authenticated courier cards and original receipt confirmation, exact amount, arrival, replay, no GPS authorization, no Pix manual collection and logout')
