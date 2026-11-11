#!/usr/bin/env bash
# Cloudflare Pages project for app.pitacco.com.br (dashboard at /).
# This intentionally does not copy marketing/index.html over the React app.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -X utf8 revisions/0.12/restore.py
cd web
npm ci
npm run build
# SPA deep links must resolve to the dashboard entrypoint.
printf '/* /index.html 200\n' > dist/_redirects
echo "Dashboard build ready in web/dist"
