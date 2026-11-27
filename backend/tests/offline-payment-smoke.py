# Only disposable CI; no provider calls or payment confirmation.
import json,urllib.request,urllib.error,subprocess,os,uuid,datetime
BASE='http://127.0.0.1:8081/api/v1/public/menus/core-checkout-fixture'
S='91000000-0000-0000-0000-000000000002'
M='91000000-0000-0000-0000-000000000001'
P='91000000-0000-0000-0000-000000000003'
methods=['pix_manual','dinheiro','cartao_credito','cartao_debito','cartao_entrega','pix_maquininha','voucher_alelo','voucher_pluxee','voucher_vr','voucher_ticket']
def call(expected,body):
    req=urllib.request.Request(BASE+'/checkout',headers={'Accept':'application/json','Content-Type':'application/json'},method='POST',data=json.dumps(body).encode())
    try: res=urllib.request.urlopen(req,timeout=12)
    except urllib.error.HTTPError as e: res=e
    with res:
        assert res.status==expected,(body['payment'],res.status,expected)
        return json.loads(res.read())
def sql(query):
    return subprocess.check_output(['psql','-h','127.0.0.1','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atc',query],env={**os.environ,'PGPASSWORD':'isolated-ci-password'},text=True).strip()
def settings(public_methods,pdv_methods):
    def arr(values):return 'array['+','.join("'"+v+"'" for v in values)+']'
    sql("begin; set local role authenticated; select set_config('request.jwt.claim.sub','"+M+"',true); select public.pitacco_save_payment_methods_only('"+S+"',"+arr(public_methods)+","+arr(pdv_methods)+",'Chave Pix fixture'); commit;")
def cart(method,index,**extra):
    return dict(request_id=str(uuid.uuid4()),customer='Cliente pagamento fictício',phone='21988889'+str(index).zfill(3),items=[dict(product_id=P,quantity=1,options=[])],fulfillment='pickup',payment=method)|extra
settings(['pix_manual'],methods)
denied=cart('dinheiro',101)
call(409,denied)
assert sql("select count(*) from public.orders where request_id='"+denied['request_id']+"'")=='0'
settings(methods,methods)
for i,method in enumerate(methods):
    body=cart(method,110+i)
    if method=='dinheiro':body['notes']='Troco para: R$ 50'
    receipt=call(200,body)['data']
    oid=str(uuid.UUID(receipt['order_id']))
    assert float(receipt['total'])==25
    stored=json.loads(sql("select receipt::text from public.orders where id='"+oid+"'"))
    assert stored['payment']==method,(method,stored['payment'])
    assert stored.get('payment_status') not in ('paid','approved','captured','confirmed','settled','pago','aprovado')
    if method=='dinheiro':
        assert float(stored['change_for'])==50 and float(stored['change_due'])==25
        assert call(200,body)['data']['order_id']==oid
        assert sql("select count(*) from public.orders where request_id='"+body['request_id']+"'")=='1'
bad=cart('dinheiro',130,notes='Troco para: R$ 10')
call(409,bad)
assert sql("select count(*) from public.orders where request_id='"+bad['request_id']+"'")=='0'
for i,method in enumerate(['fiado','pix_online','cartao_online']):
    call(422,cart(method,140+i))
settings(['pix_manual','cartao_entrega'],methods)
alias=call(200,cart('cartao_credito',150))['data']
assert float(alias['total'])==25
settings(['pix_manual'],methods)
print('PASS: offline methods, cash change, idempotency, disabled public method even when enabled at PDV, legacy card alias and specialized method denial')
