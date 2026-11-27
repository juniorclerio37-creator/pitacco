# CI only, login via Laravel; no synthetic identity accepted from HTTP input.
import json,urllib.request,urllib.error,subprocess,os,re
assert os.environ.get('APP_ENV')=='testing' and os.environ.get('GITHUB_ACTIONS')=='true'
base='http://127.0.0.1:8098/api/v1'
def call(path,expected,body=None,token=None):
    headers={'Accept':'application/json','Content-Type':'application/json'}
    if token:headers['Authorization']='Bearer '+token
    req=urllib.request.Request(base+path,method='POST',headers=headers,data=json.dumps(body or {}).encode())
    try:res=urllib.request.urlopen(req,timeout=12)
    except urllib.error.HTTPError as e:res=e
    with res:
        assert res.status==expected,(path,res.status,expected)
        return json.loads(res.read())
def sql(query):
    return subprocess.check_output(['psql','-h','127.0.0.1','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atc',query],env={**os.environ,'PGPASSWORD':'isolated-ci-password'},text=True).strip()
def login(email):
    return call('/auth/login',200,{'email':email,'password':'fixture-only-password'})['access_token']
def shift(token,action,expected=200):
    return call('/courier/shift',expected,{'action':action},token)
def count():
    return sql("select count(*) from pitacco_private.courier_gps_capabilities where courier_id='98000000-0000-0000-0000-000000000002'")
shift(None,'ready',401)
owner=login('alice@example.test')
shift(owner,'ready',403)
courier=login('courier@example.test')
assert shift(courier,'ready')['data']=={'ready':True}
push='/courier/push'
fake='fixture-only-'+'A'*40
call(push,401,{'action':'status'})
call(push,403,{'action':'status'},owner)
call(push,422,{'action':'register_native','device_token':'not-a-fixture'},courier)
call(push,422,{'action':'status','device_token':fake},courier)
assert call(push,200,{'action':'status'},courier)['data']['device_registered'] is False
legacy=call(push,200,{'action':'register_legacy','device_token':fake},courier)['data']
assert legacy['device_registered'] is True and legacy['protocol']=='notification'
native=call(push,200,{'action':'register_native','device_token':fake},courier)['data']
assert native['protocol']=='data_only' and native['server_enabled'] is False and native['dispatch_scheduled'] is False
assert fake not in json.dumps(native)
assert sql("select count(*) from pitacco_private.courier_push_device where courier_id='98000000-0000-0000-0000-000000000002'")=='1'
assert call(push,200,{'action':'unregister'},courier)['data']['device_registered'] is False
print('PASS: original push registration, native data-only protocol, legacy compatibility, explicit unregister, no real dispatch')
call('/courier/shift',422,{'action':'ready','user_id':'98000000-0000-0000-0000-000000000001'},courier)
gps=shift(courier,'start_gps')['data']['gps_token']
assert re.fullmatch('[a-f0-9]{64}',gps)
assert count()=='1'
assert shift(courier,'revoke_gps')['data']=={'revoked':True}
assert count()=='0'
sql("update public.couriers set available=false where id='98000000-0000-0000-0000-000000000002'")
shift(courier,'start_gps',403)
assert count()=='0'
sql("update public.couriers set available=true where id='98000000-0000-0000-0000-000000000002'")
new_gps=shift(courier,'start_gps')['data']['gps_token']
assert new_gps!=gps and count()=='1'
sql("update public.pitacco_courier_auth_state set must_change_password=true where user_id='98000000-0000-0000-0000-000000000001'")
shift(courier,'ready',403)
sql("update public.pitacco_courier_auth_state set must_change_password=false where user_id='98000000-0000-0000-0000-000000000001'")
call('/auth/logout',200,{},courier)
shift(courier,'start_gps',401)
call(push,401,{'action':'status'},courier)
assert sql("select count(*) from auth.sessions where user_id='98000000-0000-0000-0000-000000000001'")=='0'
print('PASS: synthetic Laravel courier login, original session readiness, GPS authorization issuance and revocation, offline, forced password change and logout')
