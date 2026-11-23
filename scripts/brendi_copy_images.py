#!/usr/bin/env python3
"""Downloads public item pictures for the user's authorized Brendi menu migration."""
import json,requests,re,time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
source=Path('imports/brendi-acai-do-linho.normalized.json')
data=json.loads(source.read_text(encoding='utf-8'))
target=Path('marketing/assets/brendi-acai-do-linho')
target.mkdir(parents=True,exist_ok=True)
headers={
 'User-Agent':'Mozilla/5.0 (Linux; Android 17) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
 'Accept':'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
 'Referer':'https://menu.brendi.com.br/acai-do-linho/',
 'Sec-Fetch-Site':'same-site',
 'Sec-Fetch-Mode':'no-cors',
 'Sec-Fetch-Dest':'image'
}
items=data['products']
sources=sorted(set(item.get('source_image_url') or item['image_url'] for item in items))
def download(url):
    m=re.fullmatch(r'https://images\.brendi\.com\.br/optimized/([0-9a-f]{32})',url)
    if not m:raise RuntimeError('External image URL not in public Brendi image domain: '+url)
    filename=m.group(1)+'.webp'
    dest=target/filename
    if not dest.exists():
        last_error=None
        for attempt in range(3):
            try:
                r=requests.get(url,headers=headers,timeout=(9,22))
                if r.status_code!=200 or not r.headers.get('content-type','').startswith('image/'):
                    raise RuntimeError(f'HTTP {r.status_code} {r.headers.get("content-type")}')
                if len(r.content)<300 or len(r.content)>8_000_000:
                    raise RuntimeError(f'Unexpected size: {len(r.content)}')
                if not r.content.startswith(b'RIFF') or r.content[8:12]!=b'WEBP':
                    raise RuntimeError('Response is not WebP')
                dest.write_bytes(r.content)
                last_error=None
                break
            except Exception as exc:
                last_error=exc
                print('RETRY_IMAGE',filename,attempt+1,type(exc).__name__,str(exc)[:120],flush=True)
                time.sleep(1+attempt)
        if last_error:raise RuntimeError(f'Image {filename} failed after 3 attempts: {last_error}')
    return (url,filename,dest.stat().st_size)
with ThreadPoolExecutor(max_workers=2) as pool:
    results=list(pool.map(download,sources))
lookup={url:filename for url,filename,_ in results}
for item in items:
    original=item.get('source_image_url') or item['image_url']
    item['source_image_url']=original
    item['image_url']='https://pitacco.com.br/assets/brendi-acai-do-linho/'+lookup[original]
source.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
print('COPIED_PUBLIC_IMAGES',len(results),'BYTES',sum(size for _,_,size in results),'PRODUCTS',len(items))
print('PRODUCT_PHOTO_HOST',items[0]['image_url'])
