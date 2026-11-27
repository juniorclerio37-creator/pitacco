# CI only, no WebSocket server or real broadcast.
import json,urllib.request,urllib.error,subprocess,os,hmac,hashlib
assert os.environ.get('APP_ENV')=='testing' and os.environ.get('GITHUB_ACTIONS')=='true'
base='http://127.0.0.1:8091/api/v1'
def call(path,status,body,token=None):
    headers={'Accept':'application/json','Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    req=urllib.request.Request(base+path,data=json.dumps(body).encode(),headers=headers,method='POST')
    try: res=urllib.request.urlopen(req,timeout=10)
    except urllib.error.HTTPError as e: res=e
    with res:
        assert res.status==status,(path,res.status,status)
        result=json.loads(res.read())
        if path=='/realtime/auth':
            assert 'no-store' in res.headers.get('Cache-Control','') or status==422
            if status!=200: assert 'auth' not in result
        return result
def login(email):
    return call('/auth/login',200,{'email':email,'password':'fixture-only-password'})['access_token']
def sql(q):
    subprocess.run(['psql','-h','127.0.0.1','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',q],env={**os.environ,'PGPASSWORD':'isolated-ci-password'},check=True,capture_output=True)
owner=login('alice@example.test')
operator=login('bob@example.test')
a='20000000-0000-4000-8000-000000000001'
b='20000000-0000-4000-8000-000000000002'
channel='private-pitacco.store.'+a
p={'socket_id':'1234.5678','channel_name':channel}
call('/realtime/auth',401,p)
call('/realtime/auth',404,p,operator)
call('/realtime/auth',404,p|{'channel_name':'private-pitacco.store.'+b},owner)
call('/realtime/auth',422,p|{'channel_name':'pitacco.store.'+a},owner)
call('/realtime/auth',422,p|{'channel_name':'presence-pitacco.store.'+a},owner)
call('/realtime/auth',422,p|{'socket_id':'1234:5678'},owner)
call('/realtime/auth',422,p|{'unexpected':'x'},owner)
def expected(socket):
    return {'auth':os.environ['PITACCO_REALTIME_KEY']+':'+hmac.new(os.environ['PITACCO_REALTIME_SECRET'].encode(),(socket+':'+channel).encode(),hashlib.sha256).hexdigest()}
assert call('/realtime/auth',200,p,owner)==expected(p['socket_id'])
assert call('/realtime/auth',200,p|{'socket_id':'1234.5679'},owner)==expected('1234.5679')
sql("update core_auth.memberships set active=false where user_id='10000000-0000-4000-8000-000000000001' and store_id='"+a+"'")
call('/realtime/auth',404,p,owner)
call('/auth/logout',200,{},owner)
call('/realtime/auth',401,p,owner)
print('PASS: private channel signature, socket binding, store isolation, role, revoked membership and logout')
