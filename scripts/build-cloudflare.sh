#!/usr/bin/env bash
set -euo pipefail
# Cloudflare/site builds do not compile the Windows native audio modules.
export PITACCO_WEB_ONLY=1
cd "$(dirname "$0")/.."
dist_dir=web/dist
export VITE_PITACCO_HOMOLOGACAO=0
if [[ "${1:-}" == "--homologacao" && "$#" == 1 ]]; then
  dist_dir=web/dist-homologacao
  export VITE_PITACCO_HOMOLOGACAO=1
  export VITE_SUPABASE_URL="${PITACCO_HOMOLOG_SUPABASE_URL:-}"
  export VITE_SUPABASE_ANON_KEY="${PITACCO_HOMOLOG_SUPABASE_KEY:-}"
elif [[ "$#" != 0 ]]; then
  echo "Uso: bash scripts/build-cloudflare.sh [--homologacao]" >&2
  exit 1
fi

python3 -X utf8 revisions/0.12/restore.py
if [[ "$VITE_PITACCO_HOMOLOGACAO" == 1 ]]; then
  node scripts/homologation-site.mjs
fi
cd web
npm ci
npm run build -- --outDir "${dist_dir#web/}"
cd ..
mkdir -p "$dist_dir"/app "$dist_dir"/cadastro "$dist_dir"/privacidade "$dist_dir"/termos "$dist_dir"/sistema "$dist_dir"/configuracao "$dist_dir"/produtos "$dist_dir"/complementos "$dist_dir"/cardapio "$dist_dir"/pedidos "$dist_dir"/aceite "$dist_dir"/acompanhar "$dist_dir"/identidade
cp "$dist_dir"/index.html "$dist_dir"/app/index.html
cp marketing/index.html "$dist_dir"/index.html
python3 scripts/embed-partner-logos.py "$dist_dir"/index.html
cp marketing/cadastro.html "$dist_dir"/cadastro/index.html
cp marketing/privacidade.html "$dist_dir"/privacidade/index.html
cp marketing/termos.html "$dist_dir"/termos/index.html
cp marketing/sistema.html "$dist_dir"/sistema/index.html
cp marketing/configuracao.html "$dist_dir"/configuracao/index.html
cp marketing/produtos.html "$dist_dir"/produtos/index.html
cp marketing/complementos.html "$dist_dir"/complementos/index.html
cp marketing/cardapio.html "$dist_dir"/cardapio/index.html
# Fotos migradas são servidas pelo Pitacco, sem depender da CDN da plataforma anterior.
if [[ -d marketing/assets/brendi-acai-do-linho ]]; then
  mkdir -p "$dist_dir"/assets/brendi-acai-do-linho
  cp marketing/assets/brendi-acai-do-linho/*.webp "$dist_dir"/assets/brendi-acai-do-linho/
fi
# Serve the locked Supabase SDK from Pitacco so startup needs no external JavaScript CDN.
printf '%s\n' 'export {createClient} from "@supabase/supabase-js";' | (
  cd web
  ./node_modules/.bin/esbuild --bundle --format=esm --platform=browser --target=es2022 --minify --outfile="${dist_dir#web/}/assets/menu-supabase.mjs"
)
# Public HTML is not a Vite entrypoint: bundle Leaflet and its CSS explicitly.
# Do not ship raw bare npm imports to the browser.
./web/node_modules/.bin/esbuild web/deliveryMap.mjs --bundle --format=esm --platform=browser --target=es2022 --loader:.png=dataurl --outfile="$dist_dir/assets/delivery-map.mjs"
test -s "$dist_dir/assets/delivery-map.css"
cp marketing/pedidos.html "$dist_dir"/pedidos/index.html
cp marketing/aceite.html "$dist_dir"/aceite/index.html
cp marketing/acompanhar.html "$dist_dir"/acompanhar/index.html
cp marketing/identidade.html "$dist_dir"/identidade/index.html
cp marketing/sw.js "$dist_dir"/sw.js

if [[ "$VITE_PITACCO_HOMOLOGACAO" == 1 ]]; then
  node scripts/homologation-site.mjs apply
  exit 0
fi

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
