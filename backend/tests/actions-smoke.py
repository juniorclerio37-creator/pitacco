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
board='/stores/'+A+'/orders/own-board'
board_actions_base=BASE
board_base='http://127.0.0.1:8087/api/v1'
BASE=board_base
ops='/stores/'+A+'/operation-settings'
call(ops,401)
call(ops,404,token=bob)
call(ops.replace(A,B),404,token=alice)
oper=call(ops,200,token=alice)['data']
assert set(oper)=={'store_id','dispatch_mode','acceptance_settings','print_sectors'} and oper['store_id']==A
assert oper['dispatch_mode']=='manual'
sector=next(x for x in oper['print_sectors'] if x['sector']=='cozinha')
assert sector['printer']=='TEST-58' and sector['width']==58 and sector['copies']==2 and sector['enabled'] is True
assert set(sector)=={'store_id','sector','printer','width','copies','enabled','sources','categories'}
sql("begin; insert into public.acceptance_settings(store_id,source,mode,enabled) values ('"+A+"','proprio','automatic',true) on conflict(store_id,source) do update set mode='automatic',enabled=true; insert into public.print_sectors(store_id,sector,printer,width,copies) values ('"+B+"','fixture-other','NO-LEAK',80,1); commit;")
oper=call(ops,200,token=alice)['data']
assert any(x['source']=='proprio' and x['mode']=='automatic' and x['enabled'] for x in oper['acceptance_settings'])
assert all(x['store_id']==A for x in oper['acceptance_settings']+oper['print_sectors'])
assert 'NO-LEAK' not in json.dumps(oper)
sql("delete from public.acceptance_settings where store_id='"+A+"' and source='proprio'; delete from public.print_sectors where store_id='"+B+"' and sector='fixture-other'")
print('PASS: operational acceptance, dispatch and printer settings read, cross-store isolation')
call(board,401)
call(board,404,token=bob)
call(board.replace(A,B),404,token=alice)
call(board+'?limit=101',422,token=alice)
# Synthetic forbidden fields at every nested level must be stripped.
sql("""update public.orders set receipt=receipt||'{"tracking_token":"private-fixture","address":{"street":"Rua Fixture","number":"10","private_token":"secret"},"items":[{"name":"Açaí","quantity":1,"unit_price":20,"modifiers":[{"name":"Leite em pó","quantity":2,"private_token":"secret"}],"private_token":"secret"}],"payment_method":"dinheiro","notes":"Sem gelo","delivery_service":"priority","payment_price":{"adjustment_cents":150,"private_token":"secret"},"reference":"Portão azul"}'::jsonb where id='30000000-0000-4000-8000-000000000001'""")
rows=call(board,200,token=alice)['data']
assert rows and all(row['store_id']==A and row['source']=='proprio' for row in rows)
assert all(row['id']!=oid(4) for row in rows)
one=next(row for row in rows if row['id']==oid(1))
assert one['receipt']['items'][0]['modifiers']==[{'name':'Leite em pó','quantity':2}]
assert one['receipt']['address']=={'street':'Rua Fixture','number':'10'}
assert one['receipt']['payment_method']=='dinheiro' and one['receipt']['notes']=='Sem gelo'
assert one['receipt']['delivery_service']=='priority' and one['receipt']['payment_price']=={'adjustment_cents':150}
assert one['receipt']['reference']=='Portão azul'
# Validate nested pizza/combo projection without modifying the operational fixtures.
projected=json.loads(sql("""select core_auth.board_receipt_fixture('{"items":[{"name":"Combo pizza","modifiers":[{"name":"Pizza","group":"Combo","options":[{"name":"Calabresa","group":"Sabor","numerator":1,"denominator":2,"private_token":"secret"}]}]}]}'::jsonb)"""))
assert projected['items'][0]['modifiers'][0]['options']==[{'name':'Calabresa','group':'Sabor','numerator':1,'denominator':2}]
assert 'private_token' not in json.dumps(rows) and 'tracking_token' not in json.dumps(rows)
assert len(call(board+'?limit=1',200,token=alice)['data'])==1
# Restore original fixture receipt before all existing action/printing assertions.
sql("""update public.orders set receipt='{"logistics":"retirada","customer":"Cliente fixture","items":[{"name":"Açaí","quantity":1,"unit_price":20,"modifiers":[]}],"total":20,"payment":"dinheiro","payment_status":"nao confirmado"}'::jsonb where id='30000000-0000-4000-8000-000000000001'""")
print('PASS: own operational board projection, nested receipt allowlist, pagination and store isolation')
BASE=board_actions_base
action(A,1,'accept',401)
action(B,3,'accept',404,alice)
action(A,1,'accept',404,bob)
action(B,3,'accept',404,bob)
action(A,3,'accept',404,alice)
action(A,4,'accept',409,alice)
action(A,1,'complete_pickup',409,alice)
action(A,1,'ready',409,alice)
def outbox_count():
    return int(sql("select count(*) from core_auth.order_invalidation_fixture"))
assert outbox_count()==0 # denied/invalid transitions must not emit
assert action(A,1,'accept',200,alice)['data']['status']=='accepted'
accepted_events=outbox_count()
assert accepted_events>0
action(A,1,'accept',200,alice)
assert outbox_count()==accepted_events # idempotent replay
assert sql("select count(*) from public.print_jobs where order_id='"+oid(1)+"'")=='2'
# Reprint uses a separate HTTP quota; never creates a second job on replay.
BASE=board_base
import uuid
reprint='/stores/'+A+'/orders/'+oid(1)+'/reprint'
rp={'request_id':str(uuid.uuid4()),'reason':'Teste de reimpressão'}
call(reprint,401,'POST',rp)
call(reprint,404,'POST',rp,bob)
call(reprint.replace(A,B),404,'POST',rp,alice)
call(reprint.replace(oid(1),oid(4)),404,'POST',rp,alice)
call(reprint.replace(oid(1),oid(2)),409,'POST',rp,alice)
call(reprint,422,'POST',rp|{'reason':'abc'},alice)
assert call(reprint,200,'POST',rp,alice)['data']['queued'] is True
assert call(reprint,200,'POST',rp,alice)['data']['queued'] is True
assert sql("select count(*) from public.print_jobs where order_id='"+oid(1)+"' and request_id='"+rp['request_id']+"'")=='2'
assert sql("select count(*) from public.print_jobs where order_id='"+oid(1)+"'")=='4'
assert sql("select count(*) from public.operation_audit where order_id='"+oid(1)+"' and action='reprint_requested' and details->>'request_id'='"+rp['request_id']+"'")=='1'
# Exercise original device binding and durable queue state, no physical printer.
queue='/stores/'+A+'/own-print/'
dev=str(uuid.uuid4());other_dev=str(uuid.uuid4())
call(queue+'bind',401,'POST',{'device_id':dev})
call(queue+'bind',404,'POST',{'device_id':dev},bob)
call(queue+'claim',404,'POST',{'device_id':dev},alice)
assert call(queue+'bind',200,'POST',{'device_id':dev},alice)['data']['bound']
assert call(queue+'bind',200,'POST',{'device_id':dev},alice)['data']['bound']
call(queue+'bind',409,'POST',{'device_id':other_dev},alice)
call(queue+'claim',404,'POST',{'device_id':other_dev},alice)
jobs=call(queue+'claim',200,'POST',{'device_id':dev},alice)['data']['jobs']
own=[j for j in jobs if j['order_id']==oid(1)]
assert len(own)==4 and all(j['state']=='claimed' and j['store_id']==A for j in own),own
assert all('tracking_token' not in j['receipt'] for j in jobs)
assert {j['id'] for j in call(queue+'claim',200,'POST',{'device_id':dev},alice)['data']['jobs']}=={j['id'] for j in jobs}
job=own[0]['id']
ack={'device_id':dev,'job_id':job,'state':'saved'}
call(queue+'ack',404,'POST',ack|{'device_id':other_dev},alice)
call(queue+'ack',404,'POST',ack,bob)
call(queue+'ack',422,'POST',ack|{'state':'pending'},alice)
assert call(queue+'ack',200,'POST',ack,alice)['data']['acknowledged']
assert call(queue+'ack',200,'POST',ack|{'state':'uncertain','error':'Fixture spooler'},alice)['data']['acknowledged']
call(queue+'ack',200,'POST',ack,alice)
assert sql("select state from public.print_jobs where id='"+job+"'")=='uncertain'
call(queue+'ack',200,'POST',ack|{'state':'submitted'},alice)
call(queue+'ack',200,'POST',ack,alice)
assert sql("select state from public.print_jobs where id='"+job+"'")=='submitted'
assert job not in {j['id'] for j in call(queue+'claim',200,'POST',{'device_id':dev},alice)['data']['jobs']}
print('PASS: original device binding, queue claim/replay, uncertain state and submitted terminal acknowledgement')
# Separate test quota; keep the same authenticated sessions and database.
device_base='http://127.0.0.1:8088/api/v1'
BASE=device_base
dp='/stores/'+A+'/print-device/'
ifood='/stores/'+A+'/orders/ifood-board'
call(ifood,401)
call(ifood,404,token=bob)
call(ifood.replace(A,B),404,token=alice)
call(ifood+'?limit=101',422,token=alice)
sql("""update public.orders set receipt='{"display_number":"1234","customer":"Cliente iFood Fixture","logistics":"marketplace","ifood_status":"PLACED","ifood_manual_accept":"requested","provider_preparation_due_at":"2026-11-27T20:00:00Z","provider_scheduled_for":"2026-11-27T21:00:00Z","delivery_fee_original":10,"delivery_fee_discount":5,"delivery_fee_customer":5,"payment_status":"paid","items":[{"name":"Açaí","quantity":1,"modifiers":[{"name":"Granola","quantity":1}]}],"phone":"PRIVATE-CONTACT","localizer":"PRIVATE-LOCATOR","contact_phone":"PRIVATE-CONTACT","raw_payload":{"secret":"PRIVATE-RAW"},"external_order_id":"PRIVATE-EXTERNAL"}'::jsonb where id='30000000-0000-4000-8000-000000000004'""")
market=call(ifood,200,token=alice)['data']
assert len(market)==1 and market[0]['id']==oid(4) and market[0]['source']=='ifood' and market[0]['store_id']==A
receipt=market[0]['receipt']
assert receipt['display_number']=='1234' and receipt['ifood_status']=='PLACED' and receipt['ifood_manual_accept']=='requested'
assert receipt['provider_scheduled_for']=='2026-11-27T21:00:00Z' and receipt['delivery_fee_customer']==5
assert receipt['items'][0]['modifiers'][0]['name']=='Granola' and receipt['payment_status']=='paid'
assert 'PRIVATE-' not in json.dumps(market)
assert call(ifood+'?limit=1&offset=1',200,token=alice)['data']==[]
sql("update public.orders set receipt='{}'::jsonb where id='"+oid(4)+"'")
print('PASS: normalized iFood operational order, provider status, deadlines, schedule, payment, no private contact or raw events, store isolation')
shipping='/stores/'+A+'/orders/'+oid(4)+'/shipping-simulation'
call(shipping,401)
call(shipping,404,token=bob)
call(shipping,404,token=alice)
call(shipping.replace(A,B),404,token=alice)
ship_merchant='38100000-0000-4000-8000-000000000001'
ship_external='38100000-0000-4000-8000-000000000002'
sql("insert into pitacco_private.ifood_merchants(merchant_id,store_id,test_only,enabled) values('"+ship_merchant+"','"+A+"',true,true)")
sql("insert into pitacco_private.ifood_order_links(external_id,order_id,merchant_id,state_rank,event_at) values('"+ship_external+"','"+oid(4)+"','"+ship_merchant+"',1,now())")
sql("update public.orders set receipt='{\"ifood_test\":true,\"logistics\":\"loja\"}'::jsonb where id='"+oid(4)+"'")
sim=call(shipping,200,token=alice)['data']
assert sim['environment']=='simulation' and sim['homologated'] is False and sim['request_enabled'] is False and sim['order_id']==oid(4)
assert sim['quote']['simulated'] is True and sim['quote']['net_value_cents']==1200 and 'id' not in sim['quote']
assert ship_merchant not in json.dumps(sim) and ship_external not in json.dumps(sim)
call(shipping+'?action=request_driver',422,token=alice)
# Use distinct test server's limiter for this isolated rehearsal.
BASE=board_base
def ship(action,revision,expected=200,**extra):
    return call(shipping,expected,'POST',{'action':action,'revision':revision,**extra},alice)
assert ship('start',0)['data']['state']=='quoted'
ship('request',1,422,confirmed=False,amount_cents=1200)
ship('status',1,422,confirmed=True)
ship('request',1,409,confirmed=True,amount_cents=1199)
assert ship('request',1,confirmed=True,amount_cents=1200)['data']['own_available'] is False
ship('request',1,409,confirmed=True,amount_cents=1200)
assert ship('uncertain',2)['data']['state']=='uncertain'
assert ship('allocated',3)['data']['state']=='allocated'
assert ship('cancel',4,confirmed=True)['data']['cancel_state']=='requesting'
assert ship('cancel_uncertain',5)['data']['own_available'] is False
done=ship('cancel_confirmed',6)['data']
assert done['state']=='cancelled' and done['own_available'] is True and done['order_preserved'] is True and done['commercial_enabled'] is False
assert ship('status',0)['data']==done
assert sql("select status from public.orders where id='"+oid(4)+"'")=='pending'
assert sql("select count(*) from pitacco_private.ifood_shipping_test_bookings where order_id='"+oid(4)+"'")=='0'
sql("delete from core_auth.shipping_rehearsal_fixture where order_id='"+oid(4)+"'")
BASE=device_base
print('PASS: persisted Shipping rehearsal, price and revision guards, uncertain reservation, cancellation proof and no real booking')
sql("update pitacco_private.ifood_merchants set test_only=false where merchant_id='"+ship_merchant+"'")
call(shipping,404,token=alice)
sql("delete from pitacco_private.ifood_order_links where external_id='"+ship_external+"';delete from pitacco_private.ifood_merchants where merchant_id='"+ship_merchant+"';update public.orders set receipt='{}'::jsonb where id='"+oid(4)+"'")
print('PASS: Shipping simulation only, test merchant and linked order, no provider quote ID, no booking or production access')
call(dp+'status',401,'POST',{})
call(dp+'status',404,'POST',{},bob)
call(dp.replace(A,B)+'status',404,'POST',{},alice)
info=call(dp+'status',200,'POST',{},alice)['data']
assert info['bound_device_id']==dev and info['printer_computer_bound'] is True
assert call(dp+'ping',200,'POST',{'device_id':dev},alice)['data']['received'] is True
info=call(dp+'status',200,'POST',{},alice)['data']
assert info['status']=='connected' and info['bound_computer_connected'] is True
assert info['automatic_print_tested'] is False and info['installation_confirmed'] is False
switch={'device_id':other_dev,'expected_device_id':dev}
call(dp+'switch',409,'POST',switch,alice)
call(dp+'unbind',409,'POST',{'device_id':dev,'expected_device_id':dev},alice)
assert call(dp+'status',200,'POST',{},alice)['data']['bound_device_id']==dev
# Mark remaining jobs as submitted only in the synthetic fixture.
BASE=board_base
for j in jobs:
    if j['id']!=job:call(queue+'ack',200,'POST',{'device_id':dev,'job_id':j['id'],'state':'submitted'},alice)
BASE=device_base
call(dp+'switch',409,'POST',switch|{'expected_device_id':None},alice)
assert call(dp+'switch',200,'POST',switch,alice)['data']['bound'] is True
call(dp+'switch',409,'POST',switch,alice)
assert call(dp+'status',200,'POST',{},alice)['data']['bound_device_id']==other_dev
call(dp+'unbind',409,'POST',{'device_id':dev,'expected_device_id':dev},alice)
assert call(dp+'unbind',200,'POST',{'device_id':other_dev,'expected_device_id':other_dev},alice)['data']['unbound'] is True
assert call(dp+'status',200,'POST',{},alice)['data']['bound_device_id'] is None
assert call(dp+'switch',200,'POST',{'device_id':dev,'expected_device_id':None},alice)['data']['bound'] is True
sql("update public.pitacco_windows_presence set last_seen_at=now()-interval '5 minutes' where store_id='"+A+"'")
assert call(dp+'status',200,'POST',{},alice)['data']['status']=='offline'
print('PASS: original Windows presence, guarded switch, stale command, pending job protection and unbind')
BASE=board_base
BASE=board_actions_base
print('PASS: original own-order reprint queue, fixed request id, two copies, role and tenant isolation')
assert sql("select count(*) from public.operation_audit where order_id='"+oid(1)+"' and action='accepted'")=='1'
assert action(A,1,'ready',200,alice)['data']['preparation_status']=='ready'
ready_events=outbox_count()
assert ready_events>accepted_events
action(A,1,'ready',200,alice)
assert outbox_count()==ready_events
assert action(A,1,'complete_pickup',200,alice)['data']['preparation_status']=='completed'
completed_events=outbox_count()
assert completed_events>ready_events
action(A,1,'complete_pickup',200,alice)
assert outbox_count()==completed_events
# Exercise a real state change and rollback under the same synthetic manager
# context. The event exists inside the transaction, but cannot escape it.
rollback_counts=sql("""begin;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select set_config('pitacco.core_session_id',(select id::text from core_auth.sessions where user_id='10000000-0000-4000-8000-000000000001' and revoked_at is null order by expires_at desc limit 1),true);
select set_config('pitacco.core_order_outbox','on',true);
select public.accept_order('30000000-0000-4000-8000-000000000002');
select count(*) from core_auth.order_invalidation_fixture;
rollback;""")
assert int(rollback_counts.splitlines()[-2])>completed_events,rollback_counts
assert outbox_count()==completed_events
assert sql("select status from public.orders where id='"+oid(2)+"'")=='pending'
action(A,2,'reject',422,alice)
assert outbox_count()==completed_events
assert action(A,2,'reject',200,alice,'Sem estoque')['data']['status']=='rejected'
reject_events=outbox_count()
assert reject_events>completed_events
action(A,2,'reject',200,alice,'Sem estoque')
assert outbox_count()==reject_events
assert sql("select count(*) from core_auth.order_invalidation_fixture where store_id<>'"+A+"' or resource<>'orders'")=='0'
print('PASS: transactional order invalidation, denied transitions, replay, rollback and store scope')
assert sql("select count(*) from public.operation_audit where order_id='"+oid(2)+"' and action='order_rejected'")=='1'
action(A,5,'ready',200,alice)
action(A,5,'complete_pickup',409,alice)
# The board has an isolated CI throttle bucket for its operations.
BASE=board_base
before_cancel=outbox_count()
action(A,5,'cancel',422,alice)
action(A,5,'cancel',404,bob,'Cancelamento fixture')
action(B,5,'cancel',404,alice,'Cancelamento fixture')
action(A,4,'cancel',409,alice,'Cancelamento fixture')
action(A,1,'cancel',409,alice,'Cancelamento fixture')
assert outbox_count()==before_cancel
assert action(A,5,'cancel',200,alice,'Cancelamento fixture')['data']['status']=='cancelled'
after_cancel=outbox_count()
assert after_cancel>before_cancel
action(A,5,'cancel',200,alice,'Cancelamento fixture')
assert outbox_count()==after_cancel
assert sql("select count(*) from public.operation_audit where order_id='"+oid(5)+"' and action='order_cancelled'")=='1'
BASE=board_actions_base
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
payment_path='/stores/'+A+'/payments/settings'
call(payment_path,401)
call(payment_path,404,token=bob)
call(payment_path.replace(A,B),404,token=alice)
original=call(payment_path,200,token=alice)['data']
assert original['payment_methods']==['dinheiro']
payload={'payment_methods':['pix_manual','cartao_credito'],'pdv_payment_methods':['dinheiro','voucher_vr'],'pix_instructions':'Instrução fictícia'}
call(payment_path,404,'PUT',payload,bob)
call(payment_path,422,'PUT',payload|{'payment_methods':['pix_online']},alice)
call(payment_path,422,'PUT',payload|{'pdv_payment_methods':['dinheiro','dinheiro']},alice)
call(payment_path,422,'PUT',payload|{'pix_instructions':''},alice)
call(payment_path,422,'PUT',payload|{'enabled':False},alice)
snapshot=sql("select concat(slug,':',enabled,':',delivery_enabled,':',pickup_enabled) from public.public_menu_settings where store_id='"+A+"'")
saved=call(payment_path,200,'PUT',payload,alice)['data']
assert saved['saved'] is True and saved['payment_methods']==payload['payment_methods'] and saved['pdv_payment_methods']==payload['pdv_payment_methods']
assert call(payment_path,200,token=alice)['data']==payload
assert sql("select concat(slug,':',enabled,':',delivery_enabled,':',pickup_enabled) from public.public_menu_settings where store_id='"+A+"'")==snapshot
print('PASS: separate payment channel settings, original publication preserved, invalid methods and tenant denial')
pricing_path='/stores/'+A+'/payments/pricing'
call(pricing_path,401)
call(pricing_path,404,token=bob)
call(pricing_path.replace(A,B),404,token=alice)
assert call(pricing_path,200,token=alice)['data']=={'drafts':[],'publication_available':False}
draft={'channel':'cardapio','method':'cartao_credito','adjustment_bps':400,'processing_cost_bps':350,'expected_revision':0}
created=call(pricing_path,200,'PUT',draft,alice)['data']
assert created['revision']==1 and created['active_revision'] is None
call(pricing_path,409,'PUT',draft,alice)
call(pricing_path,404,'PUT',draft,bob)
call(pricing_path,422,'PUT',draft|{'method':'voucher_vr'},alice)
call(pricing_path,422,'PUT',draft|{'method':'fiado'},alice)
call(pricing_path,422,'PUT',draft|{'active_adjustment_bps':400},alice)
counter=call(pricing_path,200,'PUT',draft|{'channel':'balcao','adjustment_bps':-500},alice)['data']
assert counter['revision']==1 and counter['adjustment_bps']==-500
voucher=call(pricing_path,200,'PUT',draft|{'method':'voucher_vr','adjustment_bps':0},alice)['data']
assert voucher['processing_cost_bps']==350 and voucher['adjustment_bps']==0
updated=call(pricing_path,200,'PUT',draft|{'expected_revision':1,'adjustment_bps':250},alice)['data']
assert updated['revision']==2 and updated['active_revision'] is None
rules=call(pricing_path,200,token=alice)['data']
assert len(rules['drafts'])==3 and rules['publication_available'] is False
assert sql("select public.pitacco_public_payment_price_rules('core-settings-fixture')::text")=='{}'
print('PASS: pricing drafts by channel, revision conflict, voucher cost only, no publication, role and tenant isolation')
publish_path=pricing_path+'/publish'
publication={'channel':'cardapio','method':'cartao_credito','expected_revision':2}
call(publish_path,401,'POST',publication)
call(publish_path,404,'POST',publication,bob)
call(publish_path.replace(A,B),404,'POST',publication,alice)
call(publish_path,422,'POST',publication|{'method':'voucher_vr'},alice)
call(publish_path,422,'POST',publication|{'publication_enabled':True},alice)
call(publish_path,409,'POST',publication,alice)
assert sql("select public.pitacco_public_payment_price_rules('core-settings-fixture')::text")=='{}'
# Only the disposable CI owner changes the original platform release flag.
sql("update pitacco_private.payment_pricing_release set publication_enabled=true where singleton")
try:
    call(publish_path,409,'POST',publication|{'expected_revision':1},alice)
    call(publish_path,409,'POST',publication|{'channel':'balcao','expected_revision':1},alice)
    active=call(publish_path,200,'POST',publication,alice)['data']
    assert active['active_adjustment_bps']==250 and active['active_revision']==2
    call(publish_path,200,'POST',publication,alice)
    assert sql("select count(*) from public.operation_audit where store_id='"+A+"' and action='payment_price_published'")=='1'
    assert json.loads(sql("select public.pitacco_public_payment_price_rules('core-settings-fixture')::text"))=={'cartao_credito':{'adjustment_bps':250,'revision':2}}
    # A new draft must not affect the active price.
    zero=call(pricing_path,200,'PUT',draft|{'expected_revision':2,'adjustment_bps':0},alice)['data']
    assert zero['active_adjustment_bps']==250 and zero['revision']==3
finally:
    sql("update pitacco_private.payment_pricing_release set publication_enabled=false where singleton")
# Original SQL permits safely removing an active adjustment even while release is closed.
reset=call(publish_path,200,'POST',publication|{'expected_revision':3},alice)['data']
assert reset['active_adjustment_bps']==0 and reset['active_revision']==3
assert sql("select public.pitacco_public_payment_price_rules('core-settings-fixture')::text")=='{}'
print('PASS: controlled pricing publication, closed release, eligible channel, stale revision, idempotency, draft isolation and safe removal')
report_base=BASE
BASE='http://127.0.0.1:8085/api/v1'
pdv='/stores/'+A+'/checkout'
sale={'request_id':str(uuid.uuid4()),'sale_mode':'balcao','customer':'Cliente PDV fictício','phone':'21988887701','items':[{'product_id':'31000000-0000-4000-8000-000000000001','quantity':1,'options':[]}],'payment':'dinheiro'}
call(pdv,401,'POST',sale)
call(pdv,404,'POST',sale,bob)
call(pdv.replace(A,B),404,'POST',sale,alice)
call(pdv,422,'POST',sale|{'received_amount':20},alice)
call(pdv,422,'POST',sale|{'sale_mode':'entrega'},alice)
call(pdv,409,'POST',sale|{'payment':'cartao_credito'},alice)
assert sql("select count(*) from public.orders where request_id='"+sale['request_id']+"'")=='0'
created=call(pdv,200,'POST',sale,alice)['data']
order=str(uuid.UUID(created['order_id']))
assert float(created['total'])==20
assert 'tracking_token' not in created
assert call(pdv,200,'POST',sale,alice)['data']['order_id']==order
assert sql("select count(*) from public.orders where request_id='"+sale['request_id']+"'")=='1'
assert sql("select receipt->>'merchant_sale_mode' from public.orders where id='"+order+"'")=='balcao'
assert sql("select count(*) from public.manual_payments where order_id='"+order+"'")=='0'
assert sql("select count(*) from public.operation_audit where order_id='"+order+"' and action='merchant_sale_created'")=='1'
call(pdv,409,'POST',sale|{'sale_mode':'retirada'},alice)
pickup=call(pdv,200,'POST',sale|{'request_id':str(uuid.uuid4()),'sale_mode':'retirada','payment':'voucher_vr','phone':'21988887702'},alice)['data']
assert float(pickup['total'])==20
assert sql("select receipt->>'merchant_sale_mode' from public.orders where id='"+str(uuid.UUID(pickup['order_id']))+"'")=='retirada'
print('PASS: original PDV and pickup checkout, independent payment methods, idempotency, no early receipt, tenant isolation')
# Delivery uses the original public channel payment rules, not the counter list.
def quote(req,service,expired=False):
    qid=str(uuid.uuid4())
    fee=9 if service=='priority' else 5
    min_time,max_time=(20,30) if service=='priority' else (40,60)
    expiration="- interval '1 minute'" if expired else "+ interval '10 minutes'"
    sql("insert into public.pitacco_delivery_route_quotes(id,store_id,request_id,destination_address,distance_m,fee,pricing_updated_at,expires_at,destination_latitude,destination_longitude,delivery_min_minutes,delivery_max_minutes,delivery_region,delivery_service) select '"+qid+"',store_id,'"+req+"','Rua Fixture 789',500,"+str(fee)+",updated_at,now()"+expiration+",-22.91,-43.46,"+str(min_time)+","+str(max_time)+",'Centro','"+service+"' from public.pitacco_delivery_pricing where store_id='"+A+"'")
    return qid
for i,service in enumerate(['standard','priority']):
    req=str(uuid.uuid4())
    generated=json.loads(subprocess.check_output(['node','tests/original-quote-postgres.mjs',req,service],text=True))
    qid=str(uuid.UUID(generated['quote_id']))
    assert generated['delivery_service']==service
    delivery=sale|{'request_id':req,'sale_mode':'entrega','payment':'cartao_credito','phone':'2198888771'+str(i),'address':'Rua Fixture 789','quote_id':qid}
    call(pdv,422,'POST',delivery|{'sale_mode':'retirada'},alice)
    call(pdv,422,'POST',delivery|{'quote_id':None},alice)
    call(pdv,422,'POST',delivery|{'delivery_fee':0},alice)
    call(pdv,409,'POST',delivery|{'address':'Outro endereço fictício'},alice)
    call(pdv,409,'POST',delivery|{'request_id':str(uuid.uuid4())},alice)
    call(pdv,409,'POST',delivery|{'payment':'voucher_vr'},alice)
    assert sql("select count(*) from public.orders where request_id='"+req+"'")=='0'
    result=call(pdv,200,'POST',delivery,alice)['data']
    oid2=str(uuid.UUID(result['order_id']))
    assert float(result['total'])==(29 if service=='priority' else 25)
    stored=json.loads(sql("select receipt::text from public.orders where id='"+oid2+"'"))
    assert stored['merchant_sale_mode']=='entrega' and stored['delivery_service']==service
    assert float(stored['delivery_fee'])==(9 if service=='priority' else 5)
    assert call(pdv,200,'POST',delivery,alice)['data']['order_id']==oid2
    assert sql("select count(*) from public.orders where request_id='"+req+"'")=='1'
    assert sql("select count(*) from public.manual_payments where order_id='"+oid2+"'")=='0'
req=str(uuid.uuid4())
expired=quote(req,'standard',True)
call(pdv,409,'POST',sale|{'request_id':req,'sale_mode':'entrega','payment':'cartao_credito','address':'Rua Fixture 789','quote_id':expired},alice)
assert sql("select count(*) from public.orders where request_id='"+req+"'")=='0'
print('PASS: original quote handler persisted server-calculated standard and priority quotes in PostgreSQL, merchant checkout, address and request binding, public payment methods, expired quote, idempotency')
BASE='http://127.0.0.1:8086/api/v1'
delivery_settings='/stores/'+A+'/delivery/settings'
call(delivery_settings,401)
call(delivery_settings,404,token=bob)
call(delivery_settings.replace(A,B),404,token=alice)
config=call(delivery_settings,200,token=alice)['data']
assert config['mode']=='circle' and config['radius_km']==1
area_time={'min_minutes':40,'max_minutes':60,'priority':{'enabled':True,'fee':9,'min_minutes':20,'max_minutes':30}}
circle={'mode':'circle','radius_km':2,'distance_fees':[5,6]+[7]*8,'distance_times':[area_time]*10}
call(delivery_settings,404,'PUT',circle,bob)
call(delivery_settings,422,'PUT',circle|{'latitude':-22.91},alice)
call(delivery_settings,422,'PUT',circle|{'radius_km':11},alice)
invalid=area_time|{'priority':{'enabled':True,'fee':4,'min_minutes':20,'max_minutes':30}}
call(delivery_settings,409,'PUT',circle|{'distance_times':[invalid]*10},alice)
assert call(delivery_settings,200,token=alice)['data']==config
stale_req=str(uuid.uuid4())
stale_quote=quote(stale_req,'standard')
saved=call(delivery_settings,200,'PUT',circle,alice)['data']
assert saved['radius_km']==2 and saved['distance_fees'][:2]==[5,6]
assert saved['distance_times'][0]['priority']['fee']==9
assert saved['updated_at']!=config['updated_at']
call(pdv,409,'POST',sale|{'request_id':stale_req,'sale_mode':'entrega','payment':'cartao_credito','address':'Rua Fixture 789','quote_id':stale_quote},alice)
regions=[]
for i in range(7):
    lat=-22.92+i*.001
    regions.append({'id':'fixture-'+str(i),'name':'Regiao '+str(i+1),'vertices':[[lat,-43.465],[lat,-43.455],[lat+.006,-43.455],[lat+.006,-43.465]],'fee':5+i, 'min_minutes':40,'max_minutes':60,'priority':{'enabled':True,'fee':15+i,'min_minutes':20,'max_minutes':30}})
polygons={'mode':'polygons','polygons':regions}
saved=call(delivery_settings,200,'PUT',polygons,alice)['data']
assert saved['mode']=='polygons' and len(saved['polygons'])==7
assert [p['id'] for p in saved['polygons']]==[p['id'] for p in regions]
assert saved['polygons'][6]['priority']['fee']==21
assert call(delivery_settings,200,token=alice)['data']==saved
print('PASS: merchant delivery settings, circle and seven ordered polygons, independent fees and priority, invalidation of old quotes, role isolation')
hours='/stores/'+A+'/opening-hours'
call(hours,401)
call(hours,404,token=bob)
call(hours.replace(A,B),404,token=alice)
initial=call(hours,200,token=alice)['data']
assert initial['current']['open'] is True and initial['current']['accepts_scheduled'] is True
hours_body={'periods':initial['periods'],'paused':False,'accepts_scheduled':True,'expected_revision':initial['revision']}
call(hours,404,'PUT',hours_body,bob)
call(hours,422,'PUT',hours_body|{'timezone':'UTC'},alice)
call(hours,422,'PUT',hours_body|{'periods':[initial['periods'][0]]*2},alice)
overlap=[{'weekday':7,'slot':1,'opens_minute':1200,'closes_minute':120},{'weekday':1,'slot':1,'opens_minute':60,'closes_minute':180}]
call(hours,409,'PUT',hours_body|{'periods':overlap},alice)
assert call(hours,200,token=alice)['data']['revision']==initial['revision']
paused=call(hours,200,'PUT',hours_body|{'paused':True},alice)['data']
assert paused['revision']==initial['revision']+1 and paused['current']['reason']=='paused'
assert paused['current']['scheduling_available'] is False
assert sql("select cardinality(public.pitacco_public_schedule_slots('core-settings-fixture','pickup'))")=='0'
call(pdv,409,'POST',sale|{'request_id':str(uuid.uuid4())},alice)
# A confirmed sale remains recoverable while the store is closed.
assert call(pdv,200,'POST',sale,alice)['data']['order_id']==order
call(hours,409,'PUT',hours_body,alice)
resumed=call(hours,200,'PUT',hours_body|{'expected_revision':paused['revision']},alice)['data']
assert resumed['current']['open'] is True and resumed['current']['scheduling_available'] is True
assert int(sql("select cardinality(public.pitacco_public_schedule_slots('core-settings-fixture','pickup'))"))>0
overnight=[{'weekday':5,'slot':1,'opens_minute':1200,'closes_minute':120}]
night=call(hours,200,'PUT',hours_body|{'periods':overnight,'accepts_scheduled':False,'expected_revision':resumed['revision']},alice)['data']
assert night['periods']==overnight
assert night['current']['accepts_scheduled'] is False
assert sql("select pitacco_private.store_opening_status('"+A+"','2026-11-21 01:30:00-03')->>'open'")=='true'
assert sql("select pitacco_private.store_opening_status('"+A+"','2026-11-21 02:00:00-03')->>'open'")=='false'
call(hours,200,'PUT',hours_body|{'expected_revision':night['revision']},alice)
print('PASS: weekly opening hours, revision, pause/resume, overnight, appointment slots, closed checkout and committed retry, tenant isolation')
# Separate local preparation from the provider's official state; synthetic only.
BASE=device_base
ready_id='38000000-0000-4000-8000-000000000001'
ready_path='/stores/'+A+'/orders/'+ready_id+'/ifood-ready'
sql("insert into public.orders(id,store_id,channel,gross,source,status,preparation_status,receipt) values ('"+ready_id+"','"+A+"','iFood',25,'ifood','accepted','preparing','{\"ifood_status\":\"CONFIRMED\",\"logistics\":\"loja\"}'::jsonb)")
call(ready_path,401,'POST',{})
call(ready_path,404,'POST',{},bob)
call(ready_path.replace(A,B),404,'POST',{},alice)
call(ready_path.replace(ready_id,oid(1)),404,'POST',{},alice)
call(ready_path.replace(ready_id,oid(4)),409,'POST',{},alice)
call(ready_path,422,'POST',{'action':'dispatch'},alice)
sql("update public.orders set receipt=receipt||'{\"ifood_manual_cancel\":\"requested\"}'::jsonb where id='"+ready_id+"'")
call(ready_path,409,'POST',{},alice)
sql("update public.orders set receipt=receipt-'ifood_manual_cancel' where id='"+ready_id+"'")
ready=call(ready_path,200,'POST',{},alice)['data']
assert ready=={'id':ready_id,'store_id':A,'status':'accepted','preparation_status':'ready','ifood_status':'CONFIRMED'}
assert call(ready_path,200,'POST',{},alice)['data']==ready
assert sql("select count(*) from public.operation_audit where order_id='"+ready_id+"' and action='preparation_changed'")=='1'
assert sql("select count(*) from public.print_jobs where order_id='"+ready_id+"'")=='0'
assert sql("select count(*) from pitacco_private.ifood_courier_dispatch f join public.deliveries d on d.id=f.delivery_id where d.order_id='"+ready_id+"'")=='0'
print('PASS: local iFood readiness, official state preserved, repeat, pending cancellation, no dispatch or print jobs')
# Separate print-specific limiter; never loosen the original rate limit.
print_base='http://127.0.0.1:8096/api/v1'
BASE=print_base
# Separate reprint command: no provider call or status mutation.
market_print='/stores/'+A+'/orders/'+ready_id+'/ifood-reprint'
market_rp={'request_id':'38000000-0000-4000-8000-000000000003','reason':'Reimpressao de teste iFood'}
call(market_print,401,'POST',market_rp)
call(market_print,404,'POST',market_rp,bob)
call(market_print.replace(A,B),404,'POST',market_rp,alice)
call(market_print.replace(ready_id,oid(1)),404,'POST',market_rp,alice)
call(market_print.replace(ready_id,oid(4)),409,'POST',market_rp,alice)
call(market_print,422,'POST',market_rp|{'phone':'PRIVATE'},alice)
sql("update public.orders set receipt=receipt||'{\"ifood_manual_cancel\":\"requested\"}'::jsonb where id='"+ready_id+"'")
call(market_print,409,'POST',market_rp,alice)
sql("update public.orders set receipt=receipt-'ifood_manual_cancel' where id='"+ready_id+"'")
assert call(market_print,200,'POST',market_rp,alice)['data']=={'queued':True}
assert call(market_print,200,'POST',market_rp,alice)['data']=={'queued':True}
assert sql("select count(*) from public.print_jobs where order_id='"+ready_id+"' and request_id='"+market_rp['request_id']+"'")==sql("select coalesce(sum(copies),0) from public.print_sectors where store_id='"+A+"' and enabled")
assert sql("select count(*) from public.operation_audit where order_id='"+ready_id+"' and action='reprint_requested'")=='1'
assert sql("select receipt->>'ifood_status' from public.orders where id='"+ready_id+"'")=='CONFIRMED'
# The still own-only claim must fail closed; do not consume the marketplace job.
call(queue+'claim',409,'POST',{'device_id':dev},alice)
assert sql("select count(*) from public.print_jobs where order_id='"+ready_id+"' and device_id is not null")=='0'
# Claim both sources using the same device and original queue.
unified='/stores/'+A+'/unified-print/'
market_delivery='38000000-0000-4000-8000-000000000004'
sql("insert into public.deliveries(id,store_id,order_id,customer_name,address,status,source,logistics_provider) values('"+market_delivery+"','"+A+"','"+ready_id+"','Cliente Fixture','Rua Fixture','pendente','ifood','loja')")
sql("insert into public.pitacco_delivery_customer_contacts(delivery_id,store_id,phone_number,phone_localizer,phone_expires_at) values('"+market_delivery+"','"+A+"','21999999999','123456',now()+interval '5 minutes')")
sql("update public.print_jobs set receipt=receipt||'{\"phone\":\"PRIVATE-STALE\",\"localizer\":\"PRIVATE-STALE\",\"display_number\":\"4321\",\"customer\":{\"name\":\"Cliente Fixture\",\"phone\":\"PRIVATE-NESTED\"}}'::jsonb where order_id='"+ready_id+"'")
call(unified+'claim',401,'POST',{'device_id':dev})
call(unified+'claim',404,'POST',{'device_id':other_dev},alice)
call(unified.replace(A,B)+'claim',404,'POST',{'device_id':dev},alice)
claimed=call(unified+'claim',200,'POST',{'device_id':dev},alice)['data']['jobs']
market_jobs=[j for j in claimed if j['order_id']==ready_id]
assert len(market_jobs)>0 and all(j['receipt']['source']=='ifood' and j['receipt']['phone']=='21999999999' and j['receipt']['localizer']=='123456' and j['receipt']['display_number']=='4321' for j in market_jobs)
assert 'PRIVATE-' not in json.dumps(market_jobs)
assert sql("select count(*) from public.print_jobs where order_id='"+ready_id+"' and receipt->>'phone'='21999999999'")=='0'
sql("update public.pitacco_delivery_customer_contacts set phone_expires_at=now()-interval '1 second' where delivery_id='"+market_delivery+"'")
expired=[j for j in call(unified+'claim',200,'POST',{'device_id':dev},alice)['data']['jobs'] if j['order_id']==ready_id]
assert all('phone' not in j['receipt'] and 'localizer' not in j['receipt'] for j in expired)
for j in market_jobs:
    call(unified+'ack',200,'POST',{'device_id':dev,'job_id':j['id'],'state':'submitted'},alice)
assert not any(j['order_id']==ready_id for j in call(unified+'claim',200,'POST',{'device_id':dev},alice)['data']['jobs'])
sql("delete from public.pitacco_delivery_customer_contacts where delivery_id='"+market_delivery+"';delete from public.deliveries where id='"+market_delivery+"';delete from public.print_jobs where order_id='"+ready_id+"'")
print('PASS: unified native queue, scoped temporary iFood contact, expiry, immutable stored receipt and submitted acknowledgement')
print('PASS: official iFood reprint, original sectors and copies, idempotent audit, isolated queue and no provider mutation')
prefs='/stores/'+A+'/print-preferences'
call(prefs,401)
call(prefs,404,token=bob)
call(prefs.replace(A,B),404,token=alice)
call(prefs,422,'PUT',{'automatic':'true'},alice)
call(prefs,422,'PUT',{'automatic':True,'device_id':dev},alice)
assert call(prefs,200,token=alice)['data']=={'automatic':True}
assert call(prefs,200,'PUT',{'automatic':False},alice)['data']=={'automatic':False}
assert call(prefs,200,token=alice)['data']=={'automatic':False}
assert call(prefs,200,'PUT',{'automatic':True},alice)['data']=={'automatic':True}
assert call(prefs,200,token=alice)['data']=={'automatic':True}
sql("delete from pitacco_private.auto_print_preferences where store_id='"+A+"'")
print('PASS: durable original automatic print preference, strict boolean, store isolation and restart-safe readback')
BASE=actions_base
sql("update core_auth.memberships set active=false where store_id='"+A+"'")
call(hours,404,token=alice)
call(hours,404,'PUT',hours_body,alice)
call(delivery_settings,404,token=alice)
call(delivery_settings,404,'PUT',circle,alice)
call(pdv,404,'POST',sale,alice)
BASE=report_base
call(publish_path,404,'POST',publication,alice)
call(pricing_path,404,token=alice)
call(payment_path,404,token=alice)
call(payment_path,404,'PUT',payload,alice)
call(report,404,token=alice)
BASE=actions_base
call(settings,404,'POST',payment,alice)
print('PASS: manual approval, partial settlement, payment idempotency and full settlement')

call(settings,404,'POST',toggle,alice)
print('PASS: Fiado configuration, existing customer identity, approval mode and revoked access')

call(fiado,404,token=alice)
print('PASS: original Fiado manager overview, role and store isolation, revoked membership')

BASE=device_base
call(ready_path,404,'POST',{},alice)
call(ifood,404,token=alice)
BASE=print_base
call(market_print,404,'POST',market_rp,alice)
call(prefs,404,token=alice)
call(unified+'claim',404,'POST',{'device_id':dev},alice)
BASE=device_base
call(dp+'status',404,'POST',{},alice)
call(dp+'ping',404,'POST',{'device_id':dev},alice)
BASE=board_base
call(queue+'claim',404,'POST',{'device_id':dev},alice)
call(reprint,404,'POST',rp,alice)
call(ops,404,token=alice)
call(board,404,token=alice)
BASE=board_actions_base
action(A,1,'accept',404,alice)
print('PASS: original SQL accept, ready, pickup, rejection, retry, print queue, tenant and marketplace isolation')
