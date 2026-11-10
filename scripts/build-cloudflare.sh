#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -X utf8 revisions/0.12/restore.py
cd web
npm ci
npm run build
cd ..
# Preserve the original Vite manager entrypoint under /app/.
mkdir -p web/dist/app web/dist/cadastro
cp web/dist/index.html web/dist/app/index.html
# The marketing homepage is the public entrypoint, not the private dashboard.
cp marketing/index.html web/dist/index.html
# Registration currently hands off to the app's existing auth screen.
cat > web/dist/cadastro/index.html <<'HTML'
<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cadastro | Pitacco</title><meta http-equiv="refresh" content="0;url=/app/"></head><body><p>Redirecionando para o acesso ao Pitacco. <a href="/app/">Continuar</a></p></body></html>
HTML
