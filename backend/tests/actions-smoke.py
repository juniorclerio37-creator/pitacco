import json,urllib.request,urllib.error,subprocess,os
BASE='http://127.0.0.1:8080/api/v1'
A='20000000-0000-4000-8000-000000000001'
B='20000000-0000-4000-8000-000000000002'
def oid(n):return '30000000-0000-4000-8000-00000000000'+str(n)
def call(path,expected,method='GET',body=None,token=None):
    headers={'Accept':'application/json','Content-Type':'application/json'}
    if token:headers['Authorization']='Bearer '+token
    req=urllib.request.Request(BASE+path,headers=headers,method=method,data=json.dumps(body).encode() if body is not None else None)
    try:res=urllib.request.urlopen(req,timeout=12)
    except urllib.error.HTTPError as e:res=e
    with res:
        raw=res.read()
        assert res.status==expected,(path,res.status,expected,raw[:300])
        return json.loads(raw)
def login(email):
    return call('/auth/login',200,'POST',{'email':email,'password':'fixture-only-password'})['access_token']
def sql(query):
    return subprocess.check_output(['psql','-h','127.0.0.1','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atc',query],env={**os.environ,'PGPASSWORD':'isolated-ci-password'},text=True).strip()
def action(store,n,verb,expected,token=None,reason=None):
    data={'action':verb}
    if reason is not None:data['reason']=reason
    return call('/stores/'+store+'/orders/'+oid(n)+'/actions',expected,'POST',data,token)
alice=login('alice@example.test')
bob=login('bob@example.test')
action(A,1,'accept',401)
action(B,3,'accept',404,alice)
action(A,1,'accept',404,bob)
action(B,3,'accept',404,bob)
action(A,3,'accept',404,alice)
action(A,4,'accept',409,alice)
action(A,1,'complete_pickup',409,alice)
action(A,1,'ready',409,alice)
assert action(A,1,'accept',200,alice)['data']['status']=='accepted'
action(A,1,'accept',200,alice)
assert sql("select count(*) from public.print_jobs where order_id='"+oid(1)+"'")=='2'
assert sql("select count(*) from public.operation_audit where order_id='"+oid(1)+"' and action='accepted'")=='1'
assert action(A,1,'ready',200,alice)['data']['preparation_status']=='ready'
action(A,1,'ready',200,alice)
assert action(A,1,'complete_pickup',200,alice)['data']['preparation_status']=='completed'
action(A,1,'complete_pickup',200,alice)
action(A,2,'reject',422,alice)
assert action(A,2,'reject',200,alice,'Sem estoque')['data']['status']=='rejected'
action(A,2,'reject',200,alice,'Sem estoque')
assert sql("select count(*) from public.operation_audit where order_id='"+oid(2)+"' and action='order_rejected'")=='1'
action(A,5,'ready',200,alice)
action(A,5,'complete_pickup',409,alice)
assert sql("select status from public.orders where id='"+oid(4)+"'")=='pending'
fiado='/stores/'+A+'/fiado'
call(fiado,401)
call('/stores/'+B+'/fiado',404,token=alice)
call(fiado,404,token=bob)
call('/stores/'+B+'/fiado',404,token=bob)
overview=call(fiado,200,token=alice)['data']
assert overview['enabled'] is True
assert len(overview['customers'])==1 and overview['customers'][0]['name']=='Conta fictícia A'
assert float(overview['customers'][0]['limit'])==100
assert 'pin_hash' not in overview['customers'][0]
assert overview['charges']==[] and overview['payments']==[]
settings=fiado+'/settings'
toggle={'action':'toggle','enabled':False}
call(settings,401,'POST',toggle)
call(settings,404,'POST',toggle,bob)
call('/stores/'+B+'/fiado/settings',404,'POST',toggle,alice)
assert call(settings,200,'POST',toggle,alice)['data']['enabled'] is False
assert call(fiado,200,token=alice)['data']['enabled'] is False
assert call(settings,200,'POST',toggle|{'enabled':True},alice)['data']['enabled'] is True
customer={'action':'save_customer','name':'Conta fictícia A','phone':'21988881110','limit':125.50,'enabled':True,'due_days':14,'approval_mode':'automatic','block_overdue':True}
cid=call(settings,200,'POST',customer,alice)['data']['customer_id']
assert cid==overview['customers'][0]['id']
updated=call(fiado,200,token=alice)['data']['customers'][0]
assert float(updated['limit'])==125.50 and updated['approval_mode']=='automatic' and updated['due_days']==14
call(settings,422,'POST',customer|{'limit':-1},alice)
call(settings,422,'POST',customer|{'approval_mode':'other'},alice)
call(settings,422,'POST',customer|{'used':0},alice)
assert call(fiado,200,token=alice)['data']['customers'][0]==updated
# Synthetic credit generated through the original authorized PDV operation.
import uuid
call(settings,200,'POST',customer|{'approval_mode':'manual'},alice)
request_id=str(uuid.uuid4())
sql("begin; set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true); select public.pitacco_fiado_balcao_create('"+A+"','"+cid+"','"+request_id+"','[{\"product_id\":\"31000000-0000-4000-8000-000000000001\",\"quantity\":1,\"options\":[]}]','Fixture'); commit;")
credit_order=sql("select id from public.orders where store_id='"+A+"' and request_id='"+request_id+"'")
credit_path='/stores/'+A+'/orders/'+credit_order+'/actions'
decision={'action':'approve','order_id':credit_order,'approve':True}
call(settings,404,'POST',decision,bob)
assert call(credit_path,409,'POST',{'action':'accept'},alice)['error']=='transition_not_allowed'
assert sql("select status from public.orders where id='"+credit_order+"'")=='pending'
assert call(settings,200,'POST',decision,alice)['data']['decided'] is True
assert call(credit_path,200,'POST',{'action':'accept'},alice)['data']['status']=='accepted'
call(credit_path,200,'POST',{'action':'ready'},alice)
call(credit_path,200,'POST',{'action':'complete_pickup'},alice)
assert sql("select state from public.pitacco_fiado_charges where order_id='"+credit_order+"'")=='open'
payment={'action':'receive','customer_id':cid,'request_id':str(uuid.uuid4()),'amount':8,'method':'pix'}
call(settings,401,'POST',payment)
call(settings,404,'POST',payment,bob)
call(settings,409,'POST',payment|{'amount':21},alice)
partial=call(settings,200,'POST',payment,alice)['data']
assert float(partial['remaining'])==12 and partial['duplicate'] is False
replay=call(settings,200,'POST',payment,alice)['data']
assert replay['payment_id']==partial['payment_id'] and replay['duplicate'] is True and float(replay['remaining'])==12
call(settings,409,'POST',payment|{'amount':9},alice)
last=call(settings,200,'POST',payment|{'request_id':str(uuid.uuid4()),'amount':12,'method':'dinheiro'},alice)['data']
assert float(last['remaining'])==0
assert sql("select state from public.pitacco_fiado_charges where order_id='"+credit_order+"'")=='settled'
assert sql("select count(*) from public.pitacco_fiado_payments where customer_id='"+cid+"'")=='2'
assert sql("select sum(amount) from public.pitacco_fiado_payments where customer_id='"+cid+"'")=='20.00'
actions_base=BASE
BASE='http://127.0.0.1:8084/api/v1'
report='/stores/'+A+'/reports/financial?start=2026-11-16&end=2026-11-16'
call(report,401)
call(report,404,token=bob)
call(report.replace(A,B),404,token=alice)
call('/stores/'+A+'/reports/financial?start=2026-11-17&end=2026-11-16',422,token=alice)
call('/stores/'+A+'/reports/financial?start=2025-11-15&end=2026-11-16',422,token=alice)
r=call(report,200,token=alice)['data']
assert r['timezone']=='America/Sao_Paulo'
metrics={x['metric']:x for x in r['metrics']}
assert float(metrics['vendas']['amount'])==198
assert float(metrics['acrescimos_pagamento']['amount'])==3
assert float(metrics['descontos_pagamento']['amount'])==5
assert float(metrics['recebimentos']['amount'])==103 and metrics['recebimentos']['entries']==1
assert all(set(x)=={'metric','channel','amount','entries'} for x in r['metrics'])
today=sql("select (now() at time zone 'America/Sao_Paulo')::date")
today_report='/stores/'+A+'/reports/financial?start='+today+'&end='+today
current={x['metric']:x for x in call(today_report,200,token=alice)['data']['metrics']}
assert float(current['recebimentos_fiado']['amount'])==20 and current['recebimentos_fiado']['entries']==2
assert float(current['recebimentos']['amount'])==0
print('PASS: original financial aggregates, local calendar, price adjustments once, receipt separation, tenant and role isolation')
sql("update core_auth.memberships set active=false where store_id='"+A+"'")
call(report,404,token=alice)
BASE=actions_base
call(settings,404,'POST',payment,alice)
print('PASS: manual approval, partial settlement, payment idempotency and full settlement')

call(settings,404,'POST',toggle,alice)
print('PASS: Fiado configuration, existing customer identity, approval mode and revoked access')

call(fiado,404,token=alice)
print('PASS: original Fiado manager overview, role and store isolation, revoked membership')

action(A,1,'accept',404,alice)
print('PASS: original SQL accept, ready, pickup, rejection, retry, print queue, tenant and marketplace isolation')
