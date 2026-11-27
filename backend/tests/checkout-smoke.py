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

# Separate synthetic customer avoids interfering with the earlier checkout limit.
loyalty=cart(phone='21988886666',loyalty=True,coupon='CORE20')
l=call(SLUG+'/checkout',200,loyalty)['data']
assert float(l['total'])==20
assert call(SLUG+'/checkout',200,loyalty)['data']==l
assert sql("select uses from public.loyalty_coupons where code='CORE20'")=='1'
call(SLUG+'/checkout',422,cart(coupon='CORE20'))
call(SLUG+'/checkout',409,cart(phone='21988885555',loyalty=True,coupon='CORE20'))
assert sql("select count(*) from public.orders where store_id='91000000-0000-0000-0000-000000000002'")=='4'
print('PASS: original Fideliza checkout, coupon pricing, one-time use and retry')

# Synthetic lifecycle: complete and pay the coupon order, then exercise the original ledger.
def finish(order_id):
    sql("update public.orders set status='accepted',preparation_status='completed',receipt=receipt||'{\"payment_status\":\"paid\"}'::jsonb where id='"+str(uuid.UUID(order_id))+"'")
def earned(order_id,asset):
    return sql("select coalesce(sum(points_delta),0) from public.loyalty_ledger where order_id='"+str(uuid.UUID(order_id))+"' and event_type='earn' and asset='"+asset+"'")
finish(l['order_id'])
assert earned(l['order_id'],'points')=='20'
assert earned(l['order_id'],'orders')=='1'
assert earned(l['order_id'],'cashback')=='200'
finish(l['order_id'])
assert earned(l['order_id'],'cashback')=='200'
redeem=cart(phone=loyalty['phone'],loyalty=True,reward='cashback')
red=call(SLUG+'/checkout',200,redeem)['data']
assert float(red['total'])==23
assert call(SLUG+'/checkout',200,redeem)['data']==red
assert sql("select count(*) from public.loyalty_ledger where order_id='"+red['order_id']+"' and event_type='redeem'")=='1'
sql("update public.orders set status='cancelled' where id='"+red['order_id']+"'")
assert sql("select coalesce(sum(points_delta),0) from public.loyalty_ledger where order_id='"+red['order_id']+"' and asset='cashback'")== '0'
call(SLUG+'/checkout',409,cart(phone=loyalty['phone'],loyalty=True,reward='points'))
ref=sql("select referral_code from pitacco_private.loyalty_customers where store_id='91000000-0000-0000-0000-000000000002' and phone='21988886666'")
referred=call(SLUG+'/checkout',200,cart(phone='21988884444',loyalty=True,referral_code=ref))['data']
finish(referred['order_id'])
assert sql("select count(*) from public.loyalty_ledger where order_id='"+referred['order_id']+"' and event_type='earn' and asset='cashback'")=='3'
call(SLUG+'/checkout',422,cart(loyalty=True,coupon='CORE20',reward='cashback'))
assert sql("select count(*) from public.orders where store_id='91000000-0000-0000-0000-000000000002'")=='6'
print('PASS: points and cashback earning, redemption replay and reversal, insufficient balance, referral and exclusive discounts')

# Tracking uses only synthetic checkout capabilities, not order IDs.
def track(token,expected=200):
    req=urllib.request.Request('http://127.0.0.1:8080/api/v1/public/orders/tracking',headers={'Accept':'application/json','Content-Type':'application/json'},method='POST',data=json.dumps({'tracking_token':token}).encode())
    try:res=urllib.request.urlopen(req,timeout=12)
    except urllib.error.HTTPError as e:res=e
    with res:
        assert res.status==expected,('tracking',res.status,expected)
        assert 'no-store' in res.headers.get('Cache-Control','') if expected in (200,404) else True
        return json.loads(res.read())
t=track(first['tracking_token'])['data']
assert t['order_id']==first['order_id'] and float(t['total'])==25
assert 'phone' not in t and 'address' not in t
assert t.get('courier_position') is None
d=track(q['tracking_token'])['data']
assert d['order_id']==q['order_id'] and d['delivery_service']=='priority'
assert d.get('courier_position') is None
s=track(scheduled['tracking_token'])['data']
assert s['order_id']==scheduled['order_id'] and s['scheduled_for']
track(first['order_id'],404)
track(str(uuid.uuid4()),404)
track('invalid',422)
sql("update public.public_checkouts set expires_at=now()-interval '1 second' where order_id='"+str(uuid.UUID(first['order_id']))+"'")
track(first['tracking_token'],404)
print('PASS: private tracking, correct order, scheduled and priority fields, no pre-dispatch GPS, invalid and expired token denial')

# Original V2 device-scoped profile, synthetic customer only.
device=str(uuid.uuid4())
identity={'phone':'21988881111','device':device,'action':'load'}
assert call(SLUG+'/profile',200,identity)['data']=={'found':False,'addresses':[]}
address={'label':'Casa','street':'Rua Fixture','number':'10','neighborhood':'Centro','city':'Cidade Fixture','state':'RJ','postal':'','extra':'','is_default':True}
saved=call(SLUG+'/profile',200,identity|{'action':'save','name':'Cliente fictício','addresses':[address]})['data']
assert saved['found'] and saved['name']=='Cliente fictício'
assert saved['addresses'][0]['street']=='Rua Fixture'
loaded=call(SLUG+'/profile',200,identity)['data']
assert loaded==saved,('synthetic profile mismatch',loaded,saved)

assert call(SLUG+'/profile',200,identity|{'device':str(uuid.uuid4())})['data']=={'found':False,'addresses':[]}
assert call(SLUG+'/profile',200,identity|{'phone':'21988881112'})['data']=={'found':False,'addresses':[]}
call(SLUG+'/profile',422,{'phone':identity['phone'],'action':'load'})
call(SLUG+'/profile',422,identity|{'action':'save','name':'Cliente fictício','addresses':[address]*9})
loaded=call(SLUG+'/profile',200,identity)['data']
assert loaded==saved,('synthetic profile mismatch',loaded,saved)

print('PASS: original V2 profile, persisted address, phone and device isolation, invalid input')
