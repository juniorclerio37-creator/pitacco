import json,urllib.request,urllib.error,subprocess,os
BASE='http://127.0.0.1:8080/api/v1'
A='20000000-0000-4000-8000-000000000001'
B='20000000-0000-4000-8000-000000000002'
def call(path,expected,method='GET',body=None,token=None):
    headers={'Accept':'application/json','Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    req=urllib.request.Request(BASE+path,headers=headers,method=method,data=json.dumps(body).encode() if body is not None else None)
    try: res=urllib.request.urlopen(req,timeout=10)
    except urllib.error.HTTPError as e: res=e
    with res:
        assert res.status==expected,(path,res.status,expected)
        return json.loads(res.read())
def login(email):
    return call('/auth/login',200,'POST',{'email':email,'password':'fixture-only-password'})['access_token']
def sql(query):
    subprocess.run(['psql','-h','127.0.0.1','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',query],env={**os.environ,'PGPASSWORD':'isolated-ci-password'},check=True,capture_output=True)
# Auth smoke revokes the membership; restore ONLY the synthetic fixture.
sql("update core_auth.memberships set active=true where store_id='"+B+"'")
alice=login('alice@example.test')
bob=login('bob@example.test')
path='/stores/'+A+'/orders'
call(path,401)
data=call(path,200,token=alice)['data']
assert [row['id'][-1] for row in data]==['1','2'],data
assert all(row['store_id']==A and 'receipt' not in row for row in data)
assert call(path+'?limit=1&offset=1',200,token=alice)['data'][0]['id'][-1]=='2'
call(path+'?limit=101',422,token=alice)
call('/stores/'+B+'/orders',404,token=alice)
call(path,404,token=bob)
call('/stores/'+B+'/orders',404,token=bob) # operator is not a manager
call(path,405,'POST',token=alice)
sql("update core_auth.memberships set active=false where store_id='"+A+"'")
call(path,404,token=alice)
print('PASS: original operational SQL, Sao Paulo day boundary, active backlog, pagination, role/tenant isolation and revoked membership')
