# Synthetic fixture, no real verification service and no real customer data.
import json,urllib.request,urllib.error,subprocess,os,uuid
BASE='http://127.0.0.1:8081/api/v1/public/menus/'
SLUG='core-checkout-fixture'
STORE='91000000-0000-0000-0000-000000000002'
def call(path,expected,body):
    req=urllib.request.Request(BASE+path,headers={'Accept':'application/json','Content-Type':'application/json'},method='POST',data=json.dumps(body).encode())
    try:res=urllib.request.urlopen(req,timeout=12)
    except urllib.error.HTTPError as e:res=e
    with res:
        assert res.status==expected,(path,res.status,expected)
        return json.loads(res.read())
def sql(query):
    return subprocess.check_output(['psql','-h','127.0.0.1','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atc',query],env={**os.environ,'PGPASSWORD':'isolated-ci-password'},text=True).strip()
device=str(uuid.uuid4())
profile={'phone':'21988886666','device':device,'action':'save','name':'Carteira Fixture','addresses':[]}
call(SLUG+'/profile',200,profile)
wallet=SLUG+'/profile/wallet'
identity={'device':device}
# A self-declared telephone and even an active profile are not a verified identity.
assert call(wallet,403,identity)=={'error':'verification_required'}
call(wallet,422,identity|{'phone':profile['phone']})
# Fixture-only trusted attestation of synthetic ownership; never callable by the API role.
sql("insert into core_wallet_test.verified_devices(store_id,device_hash,phone,verified_until) select store_id,device_hash,phone,now()+interval '1 day' from pitacco_private.customer_device_sessions where store_id='"+STORE+"' and device_hash=encode(sha256(convert_to('"+device+"','UTF8')),'hex')")
w=call(wallet,200,identity)['data']
assert w['linked'] is True and w['points']>=20 and w['orders']>=1 and w['cashback_cents']>=200
assert 'referral_code' in w and isinstance(w['offers'],list)
assert 'phone' not in w and 'addresses' not in w
call(wallet,403,{'device':str(uuid.uuid4())})
call('other-store/profile/wallet',403,identity)
sql("update core_wallet_test.verified_devices set verified_until=now()-interval '1 second' where store_id='"+STORE+"' and device_hash=encode(sha256(convert_to('"+device+"','UTF8')),'hex')")
call(wallet,403,identity)
sql("update core_wallet_test.verified_devices set verified_until=now()+interval '1 day' where store_id='"+STORE+"' and device_hash=encode(sha256(convert_to('"+device+"','UTF8')),'hex')")
call(SLUG+'/profile/session',200,{'device':device,'action':'logout'})
call(wallet,403,identity)
print('PASS: wallet reads original ledger, verified identity required, wrong device/store, expired proof and logout denied')
