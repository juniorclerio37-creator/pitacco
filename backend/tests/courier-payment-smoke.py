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
# Original payment projection for the original pickup reminder, including iFood.
s='20000000-0000-4000-8000-000000000001'
market_order='98000000-0000-0000-0000-000000000091'
market_delivery='98000000-0000-0000-0000-000000000092'
cid='98000000-0000-0000-0000-000000000002'
sql("insert into public.orders(id,store_id,channel,gross,source,status,preparation_status,receipt) values('"+market_order+"','"+s+"','iFood',28,'ifood','accepted','ready','{\"ifood_status\":\"CONFIRMED\",\"logistics\":\"loja\",\"payment\":\"cartao_entrega\",\"payment_status\":\"pending\"}')")
sql("insert into public.deliveries(id,store_id,order_id,courier_id,customer_name,address,status,source,logistics_provider) values('"+market_delivery+"','"+s+"','"+market_order+"','"+cid+"','Cliente Fixture','Rua Fixture','atribuida','ifood','loja')")
unified={'action':'unified_cards'}
call(p,403,unified,owner)
call(p,401,unified,gps)
call(p,422,unified|{'delivery_id':market_delivery},courier)
assert market_delivery not in {x['delivery_id'] for x in call(p,200,cards,courier)['data']}
summaries={x['delivery_id']:x['payment'] for x in call(p,200,unified,courier)['data']}
assert summaries[market_delivery]['method']=='Cartão na entrega' and summaries[market_delivery]['state']=='collect' and float(summaries[market_delivery]['amount'])==28
assert summaries[delivery]['method']=='Dinheiro' and float(summaries[delivery]['change_for'])==50 and float(summaries[delivery]['change_due'])==16
sql("update public.orders set receipt=receipt||'{\"payment_status\":\"paid\"}'::jsonb where id='"+market_order+"'")
assert {x['delivery_id']:x['payment'] for x in call(p,200,unified,courier)['data']}[market_delivery]['state']=='paid'
assert sql("select count(*) from public.operation_audit where order_id='"+market_order+"' and action='courier_payment_received'")=='0'
sql("delete from public.deliveries where id='"+market_delivery+"';delete from public.orders where id='"+market_order+"'")
print('PASS: original courier payment summaries, mixed source, card terminal, cash change, prepaid and scoped session')
# Start at actual assignment; do not synthesize collected_at or departure.
operate('depart',409)
operate('arrive',409)
call(d,403,{'action':'collect','delivery_id':str(uuid.uuid4())},courier)
call(d,403,{'action':'collect','delivery_id':delivery},owner)
call(d,401,{'action':'collect','delivery_id':delivery},gps)
assert operate('collect')['data']=={'collected':True}
assert operate('collect')['data']=={'collected':True}
assert sql("select status from public.deliveries where id='"+delivery+"'")=='aceita'
assert sql("select (collected_at is not null)::text from public.deliveries where id='"+delivery+"'")=='true'
assert sql("select count(*) from public.operation_audit where order_id='98000000-0000-0000-0000-000000000011' and action='courier_collected'")=='1'
operate('arrive',409)
assert operate('depart')['data']=={'departed':True}
assert operate('depart')['data']=={'departed':True}
assert sql("select status from public.deliveries where id='"+delivery+"'")=='retirada'
assert sql("select count(*) from public.operation_audit where order_id='98000000-0000-0000-0000-000000000011' and action='courier_departed_single'")=='1'
operate('collect',409)
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
# Same original earnings query; only completed delivery remuneration, not
# the amount collected from the customer. Use a separate read-only CI server
# to retain the ordinary rate limits on the courier action endpoint.
def earnings(period,expected=200,token=None,extra=''):
    headers={'Accept':'application/json'}
    if token:headers['Authorization']='Bearer '+token
    req=urllib.request.Request('http://127.0.0.1:8097/api/v1/courier/earnings?period='+period+extra,headers=headers)
    try:res=urllib.request.urlopen(req,timeout=12)
    except urllib.error.HTTPError as e:res=e
    with res:
        raw=res.read()
        assert res.status==expected,(res.status,expected,raw[:250])
        return json.loads(raw)
earnings('hoje',401)
earnings('hoje',403,owner)
earnings('hoje',401,gps)
earnings('ano',422,courier)
earnings('hoje',422,courier,'&store_id='+s)
sql("update public.deliveries set courier_payment=7.50 where id='"+delivery+"'")
before=earnings('hoje',token=courier)['data']
assert before['timezone']=='America/Sao_Paulo' and before['period']=='hoje'
assert float(before['today']['amount'])==7.50 and before['today']['count']==1
assert len(before['week_chart'])==7 and float(before['week']['amount'])==7.50 and float(before['month']['amount'])==7.50
assert any(float(x['amount'])==7.50 for x in before['recent'])
for period in ['semana','mes']:
    result=earnings(period,token=courier)['data']
    assert result['period']==period and result['today']==before['today']
# Homologation orders must not alter the actual balance.
sql("update public.orders set receipt=receipt||'{\"ifood_test\":true}'::jsonb where id='98000000-0000-0000-0000-000000000011'")
assert float(earnings('hoje',token=courier)['data']['today']['amount'])==0
sql("update public.orders set receipt=receipt-'ifood_test' where id='98000000-0000-0000-0000-000000000011'")
print('PASS: original courier earnings, real remuneration, Sao Paulo calendar, test exclusion, scoped read only')
# Protected completed/cancelled list, same fields as original UI.
def history(expected=200,token=None,query=''):
    headers={'Accept':'application/json'}
    if token:headers['Authorization']='Bearer '+token
    req=urllib.request.Request('http://127.0.0.1:8097/api/v1/courier/history'+query,headers=headers)
    try:res=urllib.request.urlopen(req,timeout=12)
    except urllib.error.HTTPError as e:res=e
    with res:
        raw=res.read()
        assert res.status==expected,(res.status,expected,raw[:250])
        return json.loads(raw)
history(401)
history(403,owner)
history(401,gps)
history(422,courier,'?limit=51')
history(422,courier,'?store_id='+s)
sql("update public.deliveries set customer_name='Cliente PRIVADO',address='Rua Teste, 999 SEGREDO' where id='"+delivery+"'")
rows=history(token=courier)['data']
assert len(rows)==1 and rows[0]['status']=='entregue' and float(rows[0]['amount'])==7.50
assert rows[0]['initial']=='C.' and rows[0]['address_hint']=='Rua Test…'
assert set(rows[0])=={'number','source','status','completed_at','finished_at','arrived_at','amount','initial','address_hint'}
assert 'PRIVADO' not in json.dumps(rows) and 'SEGREDO' not in json.dumps(rows)
assert len(history(token=courier,query='?limit=1')['data'])==1
# The second synthetic delivery is cancelled only for this history test,
# then restored for any independent regression fixture.
sql("update public.deliveries set status='cancelada' where id='"+other+"'")
rows=history(token=courier)['data']
assert len(rows)==2 and any(x['status']=='cancelada' and float(x['amount'])==0 for x in rows)
print('PASS: safe courier history, completed and cancelled, amount and privacy, no active delivery data')
call('/auth/logout',200,{},courier)
history(401,courier)
earnings('hoje',401,courier)
call(d,401,{'action':'code_lengths'},courier)
call(p,401,confirm,courier)
print('PASS: authenticated courier cards and original receipt confirmation, exact amount, arrival, replay, no GPS authorization, no Pix manual collection and logout')
