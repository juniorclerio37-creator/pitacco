import json,urllib.request,urllib.error,subprocess,os,uuid,datetime
BASE='http://127.0.0.1:8080/api/v1/public/menus/'
SLUG='core-checkout-fixture'
def call(path,expected,body):
    req=urllib.request.Request(BASE+path,headers={'Accept':'application/json','Content-Type':'application/json'},method='POST',data=json.dumps(body).encode())
    try:res=urllib.request.urlopen(req,timeout=12)
    except urllib.error.HTTPError as e:res=e
    with res:
        raw=res.read()
        assert res.status==expected,(path,res.status,expected,raw[:400])
        return json.loads(raw)
def sql(query):
    return subprocess.check_output(['psql','-h','127.0.0.1','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atc',query],env={**os.environ,'PGPASSWORD':'isolated-ci-password'},text=True).strip()
def cart(**kwargs):
    return dict(request_id=str(uuid.uuid4()),customer='Cliente Fixture',phone='21999999999',items=[{'product_id':'91000000-0000-0000-0000-000000000003','quantity':1,'options':[]}],fulfillment='pickup',payment='pix_manual')|kwargs
p=cart()
first=call(SLUG+'/checkout',200,p)['data']
assert float(first['total'])==25 and first['status']=='accepted'
assert call(SLUG+'/checkout',200,p)['data']==first
call(SLUG+'/checkout',409,p|{'customer':'Alterado'})
assert call(SLUG+'/checkout/recovery',200,{'request_id':p['request_id']})['data']['order_id']==first['order_id']
assert call('other-store/checkout/recovery',200,{'request_id':p['request_id']})['data']=={'confirmed':False}
call(SLUG+'/checkout',422,cart(payment='fiado'))
call(SLUG+'/checkout',422,cart(fulfillment='delivery',address='Rua Fixture 123'))
call(SLUG+'/checkout',422,cart(total=1))
delivery=cart(request_id='92000000-0000-0000-0000-000000000011',fulfillment='delivery',address='Rua Fixture 123',quote_id='91000000-0000-0000-0000-000000000011')
q=call(SLUG+'/checkout',200,delivery)['data']
assert float(q['total'])==34 and q['status']=='accepted'
sql("update public.pitacco_delivery_route_quotes set expires_at=now()-interval '1 minute' where id='91000000-0000-0000-0000-000000000011'")
assert call(SLUG+'/checkout',200,delivery)['data']==q
slot=sql("select (public.pitacco_public_schedule_slots('core-checkout-fixture','pickup'))[1]")
schedule=datetime.datetime.fromisoformat(slot).isoformat(timespec='seconds')
scheduled=call(SLUG+'/checkout',200,cart(scheduled_for=schedule))['data']
assert scheduled['status']=='pending'
assert sql("select count(*) from public.orders where store_id='91000000-0000-0000-0000-000000000002'")=='3'
print('PASS: original checkout, server price, quote, scheduled manual acceptance, recovery and no duplicate orders')
