#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -X utf8 revisions/0.12/restore.py
cd web
npm ci
npm run build
cd ..
mkdir -p web/dist/app web/dist/cadastro web/dist/privacidade web/dist/termos web/dist/sistema web/dist/configuracao web/dist/produtos web/dist/complementos
cp web/dist/index.html web/dist/app/index.html
cp marketing/index.html web/dist/index.html
cp marketing/cadastro.html web/dist/cadastro/index.html
cp marketing/privacidade.html web/dist/privacidade/index.html
cp marketing/termos.html web/dist/termos/index.html
cp marketing/sistema.html web/dist/sistema/index.html
cp marketing/configuracao.html web/dist/configuracao/index.html
cp marketing/produtos.html web/dist/produtos/index.html
cp marketing/complementos.html web/dist/complementos/index.html
