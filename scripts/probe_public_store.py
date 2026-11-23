"""Probe only the public storefront and its public store profile; no private credentials."""
from urllib.request import Request,urlopen
from html.parser import HTMLParser
from urllib.parse import urljoin
import json,re
def fetch(url,limit=2_000_000):
 with urlopen(Request(url,headers={'User-Agent':'Mozilla/5.0 (compatible; PublicMenuProbe/1.0)','Accept':'application/json,text/html,*/*'}),timeout=15) as response:
  return response.read(limit).decode('utf8','replace')
class ScriptUrls(HTMLParser):
 def __init__(self):super().__init__();self.scripts=[]
 def handle_starttag(self,tag,attrs):
  if tag=='script':
   for key,val in attrs:
    if key=='src':self.scripts.append(val)
def shape(x,depth=0):
 if depth>2:return type(x).__name__
 if isinstance(x,dict):return {k:shape(v,depth+1) for k,v in list(x.items())[:28]}
 if isinstance(x,list):return {'count':len(x),'first':shape(x[0],depth+1) if x else None}
 return type(x).__name__
base='https://instadelivery.com.br/acaidolinho'
api='https://app.instadelivery.com.br/api/stores/by-slug/acaidolinho'
try:
 obj=json.loads(fetch(api))
 print('API_STORE_KEYS',list(obj))
 for k,v in obj.items():
  if re.search('product|group|categor|item|menu|list|collection|modif|complement',k,re.I):
   print('API_MENU_FIELD',k,json.dumps(shape(v),ensure_ascii=False)[:7500])
except Exception as e:print('API_FAILURE',type(e).__name__,str(e)[:300])
try:
 page=fetch(base)
 scripts=ScriptUrls();scripts.feed(page)
 print('HTML_LENGTH',len(page),'SCRIPTS',scripts.scripts[:25])
 for name in scripts.scripts:
  url=urljoin(base,name)
  if 'instadelivery.com.br' not in url or not url.endswith('.js'):continue
  try:
   js=fetch(url,5_000_000)
   found=sorted(set(re.findall(r'[/]api[/][a-zA-Z0-9_/$+?{}-]{5,140}',js)))
   print('JS_API_PATHS',url.split('/')[-1],len(js),found[:70])
   for needle in ['stores/by-slug','groups/','group-items','/items','menu-items','store-items','storeItem','/menu','getItems']:
    indices=[m.start() for m in re.finditer(re.escape(needle),js,re.I)]
    if indices:
     print('JS_MENU_ENDPOINT_CONTEXT',url.split('/')[-1],needle,len(indices),[js[max(0,i-95):i+160] for i in indices[:3]])
  except Exception as e:print('JS_FAILURE',str(e)[:160])
except Exception as e:print('HTML_FAILURE',str(e)[:300])
