#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -X utf8 revisions/0.12/restore.py
cd web
npm ci
npm run build
cd ..
mkdir -p web/dist/app web/dist/cadastro
cp web/dist/index.html web/dist/app/index.html
cp marketing/index.html web/dist/index.html
cp marketing/cadastro.html web/dist/cadastro/index.html
