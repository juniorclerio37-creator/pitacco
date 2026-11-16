#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -X utf8 revisions/0.12/restore.py
output=dist-admin
export VITE_PITACCO_HOMOLOGACAO=0
if [[ "${1:-}" == "--homologacao" && "$#" == 1 ]]; then
  output=dist-admin-homologacao
  export VITE_PITACCO_HOMOLOGACAO=1
  export VITE_SUPABASE_URL="${PITACCO_HOMOLOG_SUPABASE_URL:-}"
  export VITE_SUPABASE_ANON_KEY="${PITACCO_HOMOLOG_SUPABASE_KEY:-}"
  export VITE_PITACCO_HOMOLOG_SITE_ORIGIN="${PITACCO_HOMOLOG_SITE_ORIGIN:-}"
  node scripts/homologation-site.mjs
elif [[ "$#" != 0 ]]; then
  exit 1
fi
cd web
npm ci
npm run build -- --config admin.vite.config.mjs --outDir "$output"
mv "$output/admin.html" "$output/index.html"

if [[ "${VITE_PITACCO_HOMOLOGACAO:-0}" == 0 ]]; then
python3 - web/dist-admin /index.html /assets/admin-xFPoQQxb.js <<'PY_PITACCO_DEPLOY'
import base64,gzip,hashlib,sys
from pathlib import Path
root,*names=sys.argv[1:]
for name in names:
 p=Path(root)/name.lstrip('/')
 if not p.exists() and name.endswith('.js') and not name.startswith('/assets/delivery-map'):
  p=next((Path(root)/'assets').glob(name.split('/')[2].split('-')[0]+'-*.js'))
 raw=p.read_bytes()
 digest=hashlib.sha256(base64.b64encode(raw)+p.suffix[1:].encode()).hexdigest()[:32]
 value=base64.b64encode(gzip.compress(raw,mtime=0)).decode()
 for i in range(0,len(value),4096):
  print(f'PITACCO_DEPLOY {root} /{p.relative_to(root).as_posix()} {digest} {len(raw)} {i} {value[i:i+4096]}')
PY_PITACCO_DEPLOY
fi
