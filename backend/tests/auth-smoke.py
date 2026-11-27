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
request('/auth/logout',200,'POST',token=alice)
request('/auth/me',401,token=alice)
print('PASS: credential rejection, bearer sessions, live store membership, cross-store denial, expiry and revocation')
