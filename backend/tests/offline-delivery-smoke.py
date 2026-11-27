# Disposable synthetic checkout regression. No payment capture, providers or external requests.
import json,urllib.request,urllib.error,subprocess,os,uuid,datetime
BASE='http://127.0.0.1:8082/api/v1/public/menus/core-checkout-fixture'
S='91000000-0000-0000-0000-000000000002'
M='91000000-0000-0000-0000-000000000001'
P='91000000-0000-0000-0000-000000000003'
methods=['dinheiro','cartao_credito','cartao_debito','cartao_entrega','pix_maquininha','voucher_alelo','voucher_pluxee','voucher_vr','voucher_ticket','pix_manual']
def sql(query):
    return subprocess.check_output(['psql','-h','127.0.0.1','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atc',query],env={**os.environ,'PGPASSWORD':'isolated-ci-password'},text=True).strip()
def call(expected,body):
    req=urllib.request.Request(BASE+'/checkout',headers={'Accept':'application/json','Content-Type':'application/json'},method='POST',data=json.dumps(body).encode())
    try:res=urllib.request.urlopen(req,timeout=12)
    except urllib.error.HTTPError as e:res=e
    with res:
        assert res.status==expected,(body['payment'],res.status,expected)
        return json.loads(res.read())
def cart(method,i,**extra):
    return dict(request_id=str(uuid.uuid4()),customer='Entrega fictícia',phone='21988887'+str(i).zfill(3),items=[dict(product_id=P,quantity=1,options=[])],fulfillment='pickup',payment=method)|extra
array='array['+','.join("'"+m+"'" for m in methods)+']'
sql("begin; set local role authenticated; select set_config('request.jwt.claim.sub','"+M+"',true); select public.pitacco_save_payment_methods_only('"+S+"',"+array+","+array+",'Chave Pix fixture'); commit;")
for i,method in enumerate(methods):
    req=str(uuid.uuid4())
    qid=str(uuid.uuid4())
    sql("insert into public.pitacco_delivery_route_quotes(id,store_id,request_id,destination_address,distance_m,fee,pricing_updated_at,expires_at,destination_latitude,destination_longitude,delivery_min_minutes,delivery_max_minutes,delivery_region,delivery_service) select '"+qid+"',store_id,'"+req+"','Rua Fixture 789',500,9,updated_at,now()+interval '10 minutes',-22.91,-43.46,20,30,'Centro','priority' from public.pitacco_delivery_pricing where store_id='"+S+"'")
    body=cart(method,200+i,request_id=req,fulfillment='delivery',address='Rua Fixture 789',quote_id=qid)
    if method=='dinheiro':body['notes']='Troco para: R$ 50'
    data=call(200,body)['data']
    oid=str(uuid.UUID(data['order_id']))
    assert float(data['total'])==34
    stored=json.loads(sql("select receipt::text from public.orders where id='"+oid+"'"))
    summary=json.loads(sql("select pitacco_private.courier_payment_details(receipt,gross)::text from public.orders where id='"+oid+"'"))
    assert stored['payment']==method
    assert stored.get('payment_status') not in ('paid','approved','captured','confirmed','settled','pago','aprovado')
    assert summary['received_by_courier'] is False
    if method!='pix_manual':
        assert summary['state']=='collect',(method,summary)
        assert float(summary['amount'])==34
    else:
        assert summary['state']!='collect'
    if method=='dinheiro':
        assert float(summary['change_for'])==50 and float(summary['change_due'])==16
# Confirmed price is server-derived and bound to the published revision.
sql("insert into pitacco_private.payment_pricing_drafts(store_id,channel,method,adjustment_bps,active_adjustment_bps,active_revision) values('"+S+"','cardapio','cartao_credito',400,400,1) on conflict(store_id,channel,method) do update set adjustment_bps=400,active_adjustment_bps=400,active_revision=1")
priced=cart('cartao_credito',250)
call(409,priced)
call(409,priced|{'expected_cents':2500,'price_revision':1})
call(409,priced|{'expected_cents':2600,'price_revision':2})
correct=priced|{'expected_cents':2600,'price_revision':1}
confirmed=call(200,correct)['data']
assert float(confirmed['total'])==26
assert call(200,correct)['data']['order_id']==confirmed['order_id']
oid=str(uuid.UUID(confirmed['order_id']))
assert sql("select receipt->'payment_price'->>'adjustment_cents' from public.orders where id='"+oid+"'")=='100'
sql("delete from pitacco_private.payment_pricing_drafts where store_id='"+S+"' and channel='cardapio' and method='cartao_credito'")
print('PASS: all offline delivery payment summaries, exact total with priority freight, cash change, no early receipt and confirmed payment price')
