import json, urllib.request, urllib.error, subprocess, os
BASE='http://127.0.0.1:8080/api/v1'
A='20000000-0000-4000-8000-000000000001'
B='20000000-0000-4000-8000-000000000002'
def request(path,expected,method='GET',body=None,token=None):
    h={'Accept':'application/json','Content-Type':'application/json'}
    if token: h['Authorization']='Bearer '+token
    req=urllib.request.Request(BASE+path,headers=h,method=method,data=json.dumps(body).encode() if body is not None else None)
    try: res=urllib.request.urlopen(req,timeout=10)
    except urllib.error.HTTPError as e: res=e
    with res:
        assert res.status==expected,(path,res.status,expected)
        if expected==200: assert 'no-store' in res.headers.get('Cache-Control','')
        return json.loads(res.read())
def login(email,expected=200,password='fixture-only-password'):
    return request('/auth/login',expected,'POST',{'email':email,'password':password})
def sql(query):
    subprocess.run(['psql','-h','127.0.0.1','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',query],env={**os.environ,'PGPASSWORD':'isolated-ci-password'},check=True,capture_output=True)
request('/auth/me',401)
request('/auth/me',401,token='bad')
login('alice@example.test',401,'wrong')
login('unknown@example.test',401)
login('disabled@example.test',401)
alice=login('alice@example.test')['access_token']
bob=login('bob@example.test')['access_token']
assert len(alice)==64 and alice!=bob
assert [s['store_id'] for s in request('/auth/me',200,token=alice)['stores']]==[A]
assert request('/stores/'+A+'/context',200,token=alice)['data']['role']=='owner'
request('/stores/'+B+'/context',404,token=alice)
request('/stores/'+A+'/context',404,token=bob)
assert request('/stores/'+B+'/context',200,token=bob)['data']['role']=='operator'
sql("update core_auth.memberships set active=false where store_id='"+B+"'")
request('/stores/'+B+'/context',404,token=bob)
assert request('/auth/me',200,token=bob)['stores']==[]
sql("update core_auth.sessions set expires_at=now()-interval '1 second' where user_id='10000000-0000-4000-8000-000000000002'")
request('/auth/me',401,token=bob)
# Renewal only in the final 15 minutes, retains the original session ID.
request('/auth/renew',401,'POST')
request('/auth/renew',422,'POST',{'token':'untrusted'},alice)
request('/auth/renew',409,'POST',token=alice)
sql("update core_auth.sessions set expires_at=now()+interval '10 minutes' where user_id='10000000-0000-4000-8000-000000000001'")
rotated=request('/auth/renew',200,'POST',token=alice)['access_token']
assert len(rotated)==64 and rotated!=alice
request('/auth/me',401,token=alice)
request('/auth/renew',401,'POST',token=alice)
assert request('/stores/'+A+'/context',200,token=rotated)['data']['role']=='owner'
request('/auth/renew',409,'POST',token=rotated)
sql("update core_auth.sessions set created_at=now()-interval '8 hours',expires_at=now()+interval '5 minutes' where user_id='10000000-0000-4000-8000-000000000001'")
request('/auth/renew',409,'POST',token=rotated)
alice=rotated
request('/auth/logout',200,'POST',token=alice)
request('/auth/me',401,token=alice)
# Verify a synthetic legacy hash through the actual HTTP login path.
sql("update core_auth.users set password_hash=chr(36)||'2a'||chr(36)||substring(password_hash from 5) where email='alice@example.test'")
legacy=login('alice@example.test')['access_token']
assert request('/auth/me',200,token=legacy)['id']=='10000000-0000-4000-8000-000000000001'
request('/auth/logout',200,'POST',token=legacy)
sql("update core_auth.users set password_hash=chr(36)||'2y'||chr(36)||substring(password_hash from 5) where email='alice@example.test'")
sql("insert into core_auth.users(id,email,password_hash,active) values('10000000-0000-4000-8000-000000000099','invalid-hash@example.test','unsupported',true)")
login('invalid-hash@example.test',401)
print('PASS: credential rejection, bearer sessions, live store membership, cross-store denial, expiry and revocation')
