#!/usr/bin/env bash
set -euo pipefail
# Cloudflare/site builds do not compile the Windows native audio modules.
export PITACCO_WEB_ONLY=1
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
