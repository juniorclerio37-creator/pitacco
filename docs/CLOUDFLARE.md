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

## Build separado de homologação

Com a URL e a chave pública de um Supabase de teste, preencha as variáveis `PITACCO_HOMOLOG_SUPABASE_URL` e `PITACCO_HOMOLOG_SUPABASE_KEY` e execute `bash scripts/build-cloudflare.sh --homologacao`.

A saída fica em `web/dist-homologacao`. O painel em `/app/`, o cardápio, o checkout, o cadastro e o acompanhamento usam o ambiente de teste. A faixa de homologação aparece nas páginas. Para hospedar esse build, aponte exclusivamente o projeto de teste para `web/dist-homologacao` e preserve o projeto dos domínios oficiais em `web/dist`. Configure o endereço de teste como URL de retorno no Supabase Auth e como origem do diagnóstico Asaas, se aplicável.

## Pitacco Admin em domínio próprio

O domínio reservado para o proprietário é `https://admin.pitacco.com.br`. O build administrativo é criado por `bash scripts/build-admin-cloudflare.sh` em `web/dist-admin`. A configuração `wrangler.admin.jsonc` publica esse diretório em um Worker separado. O build do lojista continua em `web/dist`.

A migração `pitacco_owner_and_features` vincula o único administrador confirmado à conta proprietária. Caso existam múltiplos candidatos ou nenhum candidato confirmado, o painel aguarda a vinculação explícita por um operador autorizado do Supabase. O acesso do proprietário é validado pelo banco.

Antes de publicar o Worker, confirme as migrações no Supabase, incluindo `pitacco_platform_owner_access`. Valide o login com a conta proprietária e com uma conta gestora em homologação. Se a função exclusiva do proprietário estiver ausente, o painel bloqueia a sessão e apresenta a mensagem de verificação indisponível.

Os módulos configurados em **Módulos do lojista** são exibidos no painel web conforme o padrão global ou a regra da loja. Ocultar o módulo preserva seus dados, automações e APIs operacionais. Novas funcionalidades exigem implementação e publicação.
