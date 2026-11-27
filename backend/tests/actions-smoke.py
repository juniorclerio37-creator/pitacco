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
action(A,1,'accept',401)
action(B,3,'accept',404,alice)
action(A,1,'accept',404,bob)
action(B,3,'accept',404,bob)
action(A,3,'accept',404,alice)
action(A,4,'accept',409,alice)
action(A,1,'complete_pickup',409,alice)
action(A,1,'ready',409,alice)
assert action(A,1,'accept',200,alice)['data']['status']=='accepted'
action(A,1,'accept',200,alice)
assert sql("select count(*) from public.print_jobs where order_id='"+oid(1)+"'")=='2'
assert sql("select count(*) from public.operation_audit where order_id='"+oid(1)+"' and action='accepted'")=='1'
assert action(A,1,'ready',200,alice)['data']['preparation_status']=='ready'
action(A,1,'ready',200,alice)
assert action(A,1,'complete_pickup',200,alice)['data']['preparation_status']=='completed'
action(A,1,'complete_pickup',200,alice)
action(A,2,'reject',422,alice)
assert action(A,2,'reject',200,alice,'Sem estoque')['data']['status']=='rejected'
action(A,2,'reject',200,alice,'Sem estoque')
assert sql("select count(*) from public.operation_audit where order_id='"+oid(2)+"' and action='order_rejected'")=='1'
action(A,5,'ready',200,alice)
action(A,5,'complete_pickup',409,alice)
assert sql("select status from public.orders where id='"+oid(4)+"'")=='pending'
sql("update core_auth.memberships set active=false where store_id='"+A+"'")
action(A,1,'accept',404,alice)
print('PASS: original SQL accept, ready, pickup, rejection, retry, print queue, tenant and marketplace isolation')
