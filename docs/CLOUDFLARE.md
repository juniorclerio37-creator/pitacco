# Publicação web Pitacco — Cloudflare Workers

A fonte principal da versão 0.12 está preservada em `source/*.b64` e é reconstruída pelo script oficial `revisions/0.12/restore.py`. Não aponte a Cloudflare para a raiz como se já houvesse um `package.json` no checkout.

## Configuração no painel Workers & Pages

- Repositório: `juniorclerio37-creator/pitacco`
- Branch: `main`
- Project name: `pitacco`
- Root directory: raiz do repositório (não `web`)
- **Build command:** `bash scripts/build-cloudflare.sh`
- **Deploy command:** `npx --yes wrangler@4 deploy`

O `wrangler.jsonc` publica os arquivos estáticos de `web/dist` e usa fallback SPA para rotas internas. Não inclua chaves `service_role`, tokens da Meta ou a chave de criptografia em variáveis públicas do frontend. Se o aplicativo web usar variáveis `VITE_*`, configure apenas a URL e a chave pública/publishable do Supabase nos campos de build, depois de conferir os nomes exatos usados pelo código.

O processo executa restauração do código, instalação com lockfile e `npm run build`. Se o build falhar, examine o log antes de publicar; a execução no Cloudflare ainda precisa ser validada. O deploy do painel não publica automaticamente o backend, o instalador Windows, nem aprova a integração Meta.

Depois do primeiro deploy bem-sucedido, associe `pitacco.com.br` em Settings > Domains e ajuste DNS conforme instruções da Cloudflare. Confirme HTTPS, rotas de SPA, login e permissões antes de liberar para clientes.
