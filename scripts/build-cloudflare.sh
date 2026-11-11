#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -X utf8 revisions/0.12/restore.py
cd web
npm ci
npm run build
cd ..
mkdir -p web/dist/app web/dist/cadastro web/dist/privacidade web/dist/termos web/dist/sistema web/dist/configuracao web/dist/produtos web/dist/complementos web/dist/cardapio web/dist/pedidos web/dist/aceite web/dist/acompanhar web/dist/identidade
cp web/dist/index.html web/dist/app/index.html
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
redirect='<script>if(location.hostname.toLowerCase()==="app.pitacco.com.br"&&location.pathname==="/"){location.replace("/app/"+location.search+location.hash)}</script>'
assert '<head' in html.lower(), 'marketing index is missing a head tag'
import re
html,n=re.subn(r'(<head[^>]*>)',lambda m:m.group(1)+redirect,html,count=1,flags=re.I)
assert n==1
p.write_text(html,encoding='utf-8')
assert Path('web/dist/app/index.html').exists()
PY
