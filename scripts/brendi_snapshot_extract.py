#!/usr/bin/env python3
"""Public Brendi catalog snapshot. Runs only in an isolated GitHub Actions branch."""
import json, requests, re
from html.parser import HTMLParser
from pathlib import Path

class Capture(HTMLParser):
    def __init__(self):
        super().__init__();self.script_id=None;self.script_data=[];self.images=[]
    def handle_starttag(self,tag,attrs):
        d=dict(attrs)
        if tag=='script' and d.get('id')=='__NUXT_DATA__':self.script_id='__NUXT_DATA__'
        if tag=='img':self.images.append({k:d.get(k) for k in ['src','srcset','alt','data-src'] if d.get(k)})
    def handle_endtag(self,tag):
        if tag=='script':self.script_id=None
    def handle_data(self,data):
        if self.script_id:self.script_data.append(data)

url="https://menu.brendi.com.br/acai-do-linho/"
resp=requests.get(url,timeout=35,headers={'User-Agent':'Mozilla/5.0'})
resp.raise_for_status()
cap=Capture();cap.feed(resp.text)
raw=json.loads(''.join(cap.script_data))
print('FETCH',resp.status_code,resp.url,'HTML_BYTES',len(resp.content),'NUXT_NODES',len(raw))
TYPES={'ShallowReactive','Reactive','Set','Map','Date','BigInt','Ref','ShallowRef','Error','RegExp','URL'}
def deref(idx,depth=0,seen=None):
    if idx is None or isinstance(idx,bool):return idx
    if not isinstance(idx,int):return idx
    if idx<0:return None
    if idx>=len(raw):return None
    if depth>34:return {'__limit__':str(idx)}
    if seen is None:seen=set()
    if idx in seen:return {'__circular__':str(idx)}
    v=raw[idx]
    if not isinstance(v,(dict,list)):return v
    next_seen=seen|{idx}
    if isinstance(v,list):
        if v and isinstance(v[0],str) and v[0] in TYPES:
            if v[0] in ('ShallowReactive','Reactive','Ref','ShallowRef') and len(v)>1:
                return deref(v[1],depth+1,next_seen)
            return {'__type__':v[0],'values':[deref(x,depth+1,next_seen) for x in v[1:]]}
        return [deref(x,depth+1,next_seen) for x in v]
    return {key:deref(value,depth+1,next_seen) for key,value in v.items()}
state_idx=raw[1]['data']
state_idx=raw[state_idx][1] if isinstance(raw[state_idx],list) else state_idx
data=raw[state_idx]
menu_idx=data['menu-acai-do-linho']
menu=deref(menu_idx)
products_idx=data.get('$fIS0NM9RTziqlq0BmEFkWncheJxcGvcUQmx6NlXVmsNU')
featured=deref(products_idx) if products_idx is not None else None
images=cap.images
payload={
 'source_url':resp.url,
 'store':menu.get('store'),
 'categories':menu.get('categories'),
 'customs':menu.get('customs'),
 'products_by_category':menu.get('productsByCategory'),
 'missing_products':menu.get('missingProducts'),
 'featured':featured,
 'image_elements':images[:50],
 'sample_image_context':[],
}
for match in list(re.finditer(r'public/stores/[^"\\\s]{12,130}\\.(?:jpg|jpeg|png|webp)',resp.text))[:6]:
    payload['sample_image_context'].append(resp.text[max(0,match.start()-150):match.end()+170])
Path('imports').mkdir(exist_ok=True)
output=Path('imports/brendi-acai-do-linho.snapshot.json')
output.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf8')
cats=payload['categories'] or []
print('CATEGORIES',len(cats),[(c.get('name'),len(c.get('productsPaths',[]))) for c in cats if isinstance(c,dict)])
print('CUSTOMS',len(payload['customs'] or []))
pbc=payload['products_by_category']
print('PRODUCTS_BY_CATEGORY_TYPE',type(pbc).__name__,'KEYS',list(pbc)[:12] if isinstance(pbc,dict) else 'non-dict')
print('FIRST_PRODUCT',str(pbc)[:1700])
print('STORE',str(payload['store'])[:800])
print('IMAGES',images[:5])
print('CONTEXT',payload['sample_image_context'][:1])
print('OUTPUT',output,len(output.read_bytes()))
from concurrent.futures import ThreadPoolExecutor
unique_images=sorted(set(im.get('src','') for im in images if im.get('alt') and im.get('src') and 'images.brendi.com.br/optimized/' in im.get('src','')))
def check_image(url):
    try:
        response=requests.get(url,timeout=15,stream=True)
        content_type=response.headers.get('content-type','')
        response.close()
        return {'url':url,'status':response.status_code,'type':content_type,'ok':response.status_code==200 and content_type.startswith('image/')}
    except Exception as exc:
        return {'url':url,'status':0,'error':type(exc).__name__,'ok':False}
with ThreadPoolExecutor(max_workers=7) as pool:
    checked=list(pool.map(check_image,unique_images))
print('PHOTO_CHECK',json.dumps({'count':len(checked),'passed':sum(im['ok'] for im in checked),'failed':[im for im in checked if not im['ok']]},ensure_ascii=False))



# Diagnóstico de acesso às imagens para migração com fotos preservadas.
photo_url='https://images.brendi.com.br/optimized/1e6d9ea1eec50efc572c1c7673dd804b'
headertests={
 'referer': {'Referer':'https://menu.brendi.com.br/acai-do-linho/'},
 'browser': {'User-Agent':'Mozilla/5.0 (Linux; Android 17) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36', 'Accept':'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8','Referer':'https://menu.brendi.com.br/acai-do-linho/','Sec-Fetch-Site':'same-site','Sec-Fetch-Mode':'no-cors','Sec-Fetch-Dest':'image'},
 'browser_origin': {'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36','Accept':'image/avif,image/webp,image/*,*/*;q=0.8','Origin':'https://menu.brendi.com.br','Referer':'https://menu.brendi.com.br/'}
}
for label,headers in headertests.items():
 try:
  resp=requests.get(photo_url,headers=headers,timeout=13,stream=True)
  print('IMAGE_DIAG',label,resp.status_code,resp.headers.get('content-type'),dict((k,v) for k,v in resp.headers.items() if k.lower() in ['server','via','x-cache','content-type','location']),resp.url)
  resp.close()
 except Exception as e:print('IMAGE_DIAG_ERROR',label,type(e).__name__,str(e))
for marker in ['storage.googleapis.com','firebasestorage.googleapis.com','storageBucket','storageBucket:', 'cdn.brendi.com.br', 'images.brendi.com.br','/optimized/']:
 starts=[m.start() for m in re.finditer(re.escape(marker),resp.text)] if False else [m.start() for m in re.finditer(re.escape(marker),cap.script_data[0])][:2]
 print('HTML_MARKER',marker,resp.text.find(marker) if False else starts[:2])
