#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Preserve the standalone merchant UI before the legacy React restore.
# The restore step rewrites web/index.html; preserve the new dashboard.
PITACCO_NEW_APP="$(mktemp)"
trap 'rm -f "$PITACCO_NEW_APP"' EXIT
cp web/index.html "$PITACCO_NEW_APP"
# The legacy mobile navigation overlay targets an obsolete source shape and
# fails an assertion. The redesigned dashboard replaces this legacy route.
# Skip this overlay only in the temporary build checkout.
sed -i "/^subprocess.run(\[sys.executable,'revisions\/0.12\/mobile_orange_nav_053.py'\],check=True)$/d" revisions/0.12/restore.py
python3 -X utf8 revisions/0.12/restore.py
cd web
npm ci
npm run build
cd ..
mkdir -p web/dist/app web/dist/cadastro web/dist/privacidade web/dist/termos web/dist/sistema web/dist/configuracao web/dist/produtos web/dist/complementos web/dist/cardapio web/dist/pedidos web/dist/aceite web/dist/acompanhar web/dist/identidade
# Ship the new merchant dashboard only at /app/, retaining marketing routes.
cp "$PITACCO_NEW_APP" web/dist/app/index.html
cp marketing/index.html web/dist/index.html
cp marketing/cadastro.html web/dist/cadastro/index.html
cp marketing/privacidade.html web/dist/privacidade/index.html
cp marketing/termos.html web/dist/termos/index.html
cp marketing/sistema.html web/dist/sistema/index.html
cp marketing/configuracao.html web/dist/configuracao/index.html
cp marketing/produtos.html web/dist/produtos/index.html
cp marketing/complementos.html web/dist/complementos/index.html
cp marketing/cardapio.html web/dist/cardapio/index.html
cp marketing/pedidos.html web/dist/pedidos/index.html
cp marketing/aceite.html web/dist/aceite/index.html
cp marketing/acompanhar.html web/dist/acompanhar/index.html
cp marketing/identidade.html web/dist/identidade/index.html
cp marketing/sw.js web/dist/sw.js

# Existing Cloudflare Worker serves the same asset bundle for all three domains.
# Route the app subdomain to the already-built React dashboard at /app/,
# while keeping pitacco.com.br and www.pitacco.com.br on the marketing home.
python3 - <<'PY'
from pathlib import Path
p=Path('web/dist/index.html')
html=p.read_text(encoding='utf-8')
redirect='''<script>
(function(){
const host=location.hostname.toLowerCase(),path=location.pathname;
if(host==="app.pitacco.com.br"&&path==="/"){location.replace("/app/"+location.search+location.hash);return}
const reserved=new Set(["app","entregador","www","pitacco","admin","api","mail","cadastro","privacidade","termos","sistema","configuracao","produtos","complementos","cardapio","pedidos","aceite","acompanhar","identidade","assets","favicon.ico","sw.js"]);
const parts=path.split("/").filter(Boolean),slug=parts[0]||"";
if((host==="pitacco.com.br"||host==="www.pitacco.com.br")&&parts.length===1&&/^[a-z0-9][a-z0-9-]{2,59}$/.test(slug)&&!reserved.has(slug)){
document.documentElement.style.visibility="hidden";
fetch("/app/",{cache:"no-store"}).then(r=>{if(!r.ok)throw Error("Falha ao carregar cardápio");return r.text()}).then(html=>{document.open();document.write(html);document.close();document.documentElement.style.visibility="visible"}).catch(()=>{document.documentElement.style.visibility="visible";document.body.textContent="Não foi possível carregar o cardápio. Atualize a página."});
}
})();
</script>'''
assert '<head' in html.lower(), 'marketing index is missing a head tag'
import re
html,n=re.subn(r'(<head[^>]*>)',lambda m:m.group(1)+redirect,html,count=1,flags=re.I)
assert n==1
p.write_text(html,encoding='utf-8')
assert Path('web/dist/app/index.html').exists()
PY
