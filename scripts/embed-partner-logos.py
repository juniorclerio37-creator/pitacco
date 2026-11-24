#!/usr/bin/env python3
"""Embed the identified public partner logo assets in the built marketing page.
No image request is made by a production visitor. If an asset is unavailable,
preserve the company name rather than fabricate a logo or fail the entire site."""
import base64, concurrent.futures, re, sys
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlparse
path=Path(sys.argv[1])
html=path.read_text(encoding="utf-8")
pattern=re.compile(r'<img data-partner-logo="([a-z0-9]+)" src="(https://[^"]+)"[^>]*><span class="partner-logo-fallback" hidden>')
matches=list(pattern.finditer(html))
assert len(matches)==10, f"expected 10 partner rows, found {len(matches)}"
sources={m[1]:m[2] for m in matches}
allowed={'upload.wikimedia.org','d9hhrg4mnvzow.cloudfront.net','s3plus.meituan.net','saopaulo.wordcamp.org','www.asaas.com','d3m5pt7stxtnok.cloudfront.net','miro.medium.com'}
def fetch(item):
    key,url=item
    try:
        assert urlparse(url).hostname in allowed
        with urlopen(Request(url,headers={'User-Agent':'Pitacco site asset build/1.0 (suporte@pitacco.com.br)','Accept':'image/*'}),timeout=12) as r:
            assert urlparse(r.geturl()).scheme=='https'
            mime=r.headers.get_content_type()
            data=r.read(1000001)
        assert 0<len(data)<=1000000
        assert mime in {'image/png','image/jpeg','image/webp','image/svg+xml'}
        if mime=='image/png': assert data.startswith(b'\x89PNG\r\n\x1a\n')
        elif mime=='image/jpeg': assert data.startswith(b'\xff\xd8')
        elif mime=='image/webp': assert data[:4]==b'RIFF' and data[8:12]==b'WEBP'
        else:
            assert b'<svg' in data.lower()
            assert not re.search(rb'<(?:script|foreignObject)\b|<!DOCTYPE|<!ENTITY',data,re.I)
        print('Logo embedded:',key,flush=True)
        return key,'data:'+mime+';base64,'+base64.b64encode(data).decode('ascii')
    except Exception as error:
        print('::warning::Logo unavailable for '+key+': '+str(error)[:180],flush=True)
        return key,None
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    assets=dict(pool.map(fetch,sources.items()))
def replace(m):
    if assets[m[1]]:
        return m[0].replace(m[2],assets[m[1]],1)
    return '<span class="partner-logo-fallback">'
html=pattern.sub(replace,html)
path.write_text(html,encoding='utf-8')
print('Logo assets embedded: '+str(sum(v is not None for v in assets.values()))+'/'+str(len(assets)))
