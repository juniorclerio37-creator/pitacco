# Disposable GPS regression, using the original shift authorization.
import json,urllib.request,urllib.error,subprocess,os,re
assert os.environ.get('APP_ENV')=='testing' and os.environ.get('GITHUB_ACTIONS')=='true'
def sql(query):
    return subprocess.check_output(['psql','-q','-h','127.0.0.1','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atc',query],env={**os.environ,'PGPASSWORD':'isolated-ci-password'},text=True).strip()
def mint():
    out=sql("""begin; set local role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"97000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"97000000-0000-0000-0000-000000000003"}',true);
select public.pitacco_courier_background_gps_start(); commit;""")
    token=out.splitlines()[-1]
    assert re.fullmatch('[a-f0-9]{64}',token),'original mint did not return a valid capability'
    return token
def call(body,expected):
    req=urllib.request.Request('http://127.0.0.1:8088/api/v1/courier/gps',method='POST',headers={'Accept':'application/json','Content-Type':'application/json'},data=json.dumps(body).encode())
    try:res=urllib.request.urlopen(req,timeout=12)
    except urllib.error.HTTPError as e:res=e
    with res:
        assert res.status==expected,(res.status,expected)
        data=json.loads(res.read())
        assert body.get('p_token','not-present') not in json.dumps(data)
        return data
token=mint()
body={'p_token':token,'p_lat':-22.851234,'p_lng':-43.452894,'p_accuracy_m':20}
call(body|{'p_token':'0'*64},403)
call(body|{'p_lat':90.1},422)
call(body|{'p_accuracy_m':101},422)
call(body|{'courier_id':'97000000-0000-0000-0000-000000000002'},422)
first=call(body,200)['data']['observed_at']
assert first
assert sql("select latitude from public.courier_positions where courier_id='97000000-0000-0000-0000-000000000002'")=='-22.851234'
motion=call(body|{'p_motion_state':'moving','p_motion_confidence':90,'p_speed_mps':3},200)
assert motion['data']['observed_at']==first
assert sql("select motion_state from public.courier_positions where courier_id='97000000-0000-0000-0000-000000000002'")=='moving'
call(body|{'p_motion_state':'moving','p_motion_confidence':101},422)
sql("update public.couriers set available=false where id='97000000-0000-0000-0000-000000000002'")
call(body,403)
sql("update public.couriers set available=true where id='97000000-0000-0000-0000-000000000002'")
call(body,403)
fresh=mint()
assert fresh!=token
call(body|{'p_token':fresh},200)
sql("delete from auth.sessions where id='97000000-0000-0000-0000-000000000003'")
call(body|{'p_token':fresh},403)
print('PASS: original shift GPS capability, coordinates, motion, invalid input, offline revocation, reactivation and revoked session')
