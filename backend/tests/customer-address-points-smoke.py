# CI only: synthetic address and quote; original SQL decides whether to retain a point.
import json,urllib.request,urllib.error,subprocess,os,uuid
assert os.environ.get('APP_ENV')=='testing' and os.environ.get('GITHUB_ACTIONS')=='true'
base='http://127.0.0.1:8087/api/v1/public/menus/core-checkout-fixture'
def call(path,body,expected=200):
    req=urllib.request.Request(base+path,headers={'Accept':'application/json','Content-Type':'application/json'},method='POST',data=json.dumps(body).encode())
    try:res=urllib.request.urlopen(req,timeout=12)
    except urllib.error.HTTPError as e:res=e
    with res:
        raw=res.read()
        assert res.status==expected,(path,res.status,expected,raw[:300])
        if expected==200:assert 'no-store' in res.headers.get('Cache-Control','')
        return json.loads(raw)
def sql(query):
    return subprocess.check_output(['psql','-h','127.0.0.1','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atc',query],env={**os.environ,'PGPASSWORD':'isolated-ci-password'},text=True).strip()
qid='91000000-0000-0000-0000-000000000081'
sql("""insert into public.pitacco_delivery_route_quotes(id,store_id,request_id,destination_address,distance_m,fee,pricing_updated_at,expires_at,destination_latitude,destination_longitude,delivery_min_minutes,delivery_max_minutes,delivery_region,delivery_service,address_point_selected)
select '91000000-0000-0000-0000-000000000081',store_id,'92000000-0000-0000-0000-000000000081','Rua Fixture, 81, Centro, Cidade Fixture, RJ',500,5,updated_at,now()+interval '10 minutes',-22.91,-43.46,40,60,'Centro','standard',true
from public.pitacco_delivery_pricing where store_id='91000000-0000-0000-0000-000000000002'""")
device=str(uuid.uuid4())
identity={'phone':'21988888181','device':device}
addr={'id':str(uuid.uuid4()),'label':'Casa','street':'Rua Fixture','number':'81','neighborhood':'Centro','city':'Cidade Fixture','state':'RJ','postal':'','extra':'','is_default':True}
point={'latitude':-22.91,'longitude':-43.46}
forged={'latitude':-23.1,'longitude':-44.1}
def save(address):
    return call('/profile',identity|{'action':'save','name':'Cliente Endereço Fixture','addresses':[address]})['data']['addresses'][0]
# A user-supplied point without a verified quote is not stored.
assert 'location' not in save(addr|{'location':forged})
stored=save(addr|{'quote_id':qid,'location':forged})
assert stored['location']==point and 'quote_id' not in stored
# Resume and ordinary profile load return the exact original stored point.
assert call('/profile/session',{'device':device,'action':'resume'})['data']['addresses']==[stored]
assert call('/profile',identity|{'action':'load'})['data']['addresses']==[stored]
# Editing the label or default does not discard the existing verified point.
assert save(stored|{'label':'Trabalho','location':forged})['location']==point
# Changing the street number invalidates the prior point, even with the old quote.
changed=save(stored|{'number':'82','quote_id':qid})
assert 'location' not in changed
# An expired quote cannot authorize a new point.
sql("update public.pitacco_delivery_route_quotes set expires_at=now()-interval '1 second' where id='91000000-0000-0000-0000-000000000081'")
assert 'location' not in save(addr|{'quote_id':qid})
assert 'location' not in save(addr|{'quote_id':str(uuid.uuid4())})
# A second device cannot read the first profile.
assert call('/profile',identity|{'device':str(uuid.uuid4()),'action':'load'})['data']=={'found':False,'addresses':[]}
call('/profile',identity|{'action':'save','name':'Cliente Endereço Fixture','addresses':[addr|{'location':{'latitude':90,'longitude':0}}]},422)
print('PASS: V2 address point round trip, verified quote, forged coordinates ignored, changed address and expired quote, device isolation')
