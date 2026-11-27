import json
import urllib.request
import urllib.error

BASE='http://127.0.0.1:8080'
def get(path,expected,method='GET'):
    request=urllib.request.Request(BASE+path,headers={'Accept':'application/json'},method=method)
    try:
        response=urllib.request.urlopen(request,timeout=10)
    except urllib.error.HTTPError as e:
        response=e
    with response:
        body=response.read()
        assert response.status==expected,(path,response.status,body[:500])
        return json.loads(body) if body and response.headers.get('Content-Type','').startswith('application/json') else body

assert get('/api/v1/health/ready',200)=={'status':'ready'}
a=get('/api/v1/public/menus/loja-a',200)
b=get('/api/v1/public/menus/loja-b',200)
assert a['data']['store']['slug']=='loja-a' and a['data']['products'][0]['name']=='Açaí A'
assert b['data']['store']['slug']=='loja-b' and b['data']['products'][0]['name']=='Açaí B'
assert get('/api/v1/public/menus/inexistente',404)=={'error':'menu_unavailable'}
get('/api/v1/public/menus/invalid%20slug',404)
get('/api/v1/public/menus/loja-a',405,method='POST')
get('/api/v1/rpc/get_public_menu',404)
print('PASS: readiness, public menus, distinct stores, missing menu, invalid input, rejected writes and arbitrary RPC')
