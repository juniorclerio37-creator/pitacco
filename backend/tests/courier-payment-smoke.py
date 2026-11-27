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
d='/courier/delivery'
cards={'action':'cards'}
delivery='98000000-0000-0000-0000-000000000021'
confirm={'action':'confirm','delivery_id':delivery}
call(p,401,cards)
owner=login('alice@example.test')
call(p,403,cards,owner)
courier=login('courier@example.test')
gps=call('/courier/shift',200,{'action':'start_gps'},courier)['data']['gps_token']
call(p,401,confirm,gps)
call(d,401,{'action':'code_lengths'},gps)
call(d,403,{'action':'code_lengths'},owner)
lengths={x['delivery_id']:x['digits'] for x in call(d,200,{'action':'code_lengths'},courier)['data']}
assert lengths[delivery]==6
pin=sql("select code from public.pitacco_own_delivery_codes where delivery_id='"+delivery+"'")
assert len(pin)==6
wrong='0'*6 if pin!='0'*6 else '1'*6
def operate(action,expected=200,**extra):
    return call(d,expected,{'action':action,'delivery_id':delivery}|extra,courier)
# Existing fixture is already collected and departed. Replay must not create a new departure.
assert operate('depart')['data']=={'departed':True}
operate('verify',403,code=pin)
call(d,403,{'action':'arrive','delivery_id':str(uuid.uuid4())},courier)
result={x['delivery_id']:x['payment'] for x in call(p,200,cards,courier)['data']}
assert float(result[delivery]['amount'])==34 and float(result[delivery]['change_due'])==16
assert result[delivery]['state']=='collect'
call(p,422,confirm|{'amount':1},courier)
call(p,403,confirm|{'delivery_id':str(uuid.uuid4())},courier)
call(p,409,confirm,courier)
call(p,409,confirm|{'delivery_id':'98000000-0000-0000-0000-000000000022'},courier)
def arrive():
    return operate('arrive')['data']
arrival=arrive()
assert arrival['arrived_at'] and arrival['provider_state']=='local'
assert arrive()==arrival
assert sql("select count(*) from public.operation_audit where order_id='98000000-0000-0000-0000-000000000011' and action='courier_arrived'")=='1'
assert sql("select count(*) from public.public_order_push_events where order_id='98000000-0000-0000-0000-000000000011' and event_key='courier_arrived'")=='1'
assert sql("select status from public.deliveries where id='"+delivery+"'")=='retirada'
operate('verify',409,code=pin)
assert sql("select status from public.deliveries where id='"+delivery+"'")=='retirada'
assert operate('verify',200,code=wrong)['data']=={'verified':False,'remaining':4}
assert sql("select attempts from public.pitacco_own_delivery_codes where delivery_id='"+delivery+"'")=='1'
paid=call(p,200,confirm,courier)['data']
assert paid['state']=='paid' and paid['received_by_courier'] is True and float(paid['amount'])==34
assert call(p,200,confirm,courier)['data']==paid
assert sql("select count(*) from public.operation_audit where order_id='98000000-0000-0000-0000-000000000011' and action='courier_payment_received'")=='1'
assert sql("select status from public.deliveries where id='"+delivery+"'")=='retirada'
assert operate('verify',200,code=pin)['data']=={'verified':True,'delivered':True}
assert sql("select status from public.deliveries where id='"+delivery+"'")=='entregue'
assert sql("select count(*) from public.operation_audit where order_id='98000000-0000-0000-0000-000000000011' and action='courier_delivery_verified'")=='1'
operate('verify',403,code=pin)
other='98000000-0000-0000-0000-000000000022'
other_pin=sql("select code from public.pitacco_own_delivery_codes where delivery_id='"+other+"'")
other_wrong='0'*len(other_pin) if other_pin!='0'*len(other_pin) else '1'*len(other_pin)
for remaining in range(4,-1,-1):
    assert call(d,200,{'action':'verify','delivery_id':other,'code':other_wrong},courier)['data']=={'verified':False,'remaining':remaining}
call(d,409,{'action':'verify','delivery_id':other,'code':other_pin},courier)
assert sql("select status from public.deliveries where id='"+other+"'")=='retirada'
call('/auth/logout',200,{},courier)
call(d,401,{'action':'code_lengths'},courier)
call(p,401,confirm,courier)
print('PASS: authenticated courier cards and original receipt confirmation, exact amount, arrival, replay, no GPS authorization, no Pix manual collection and logout')
