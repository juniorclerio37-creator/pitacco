# Pitacco Intelligence — primeira versão (somente diagnóstico)

Esta entrega usa o **Cloudflare Workers AI** com o modelo `@cf/zai-org/glm-4.7-flash`, sem nova infraestrutura de banco de dados e sem serviço externo de IA cobrado por pergunta enquanto a franquia gratuita da conta não for ultrapassada.

## O que faz

- Acrescenta **Pitacco Intelligence** ao menu **Sistema** do Super Admin em `admin.pitacco.com.br`.
- Recebe uma pergunta do administrador, verifica a sessão no Supabase Auth e confirma `pitacco_is_platform_owner()` **no servidor**.
- Consulta a função já existente `pitacco_incidents()` com a mesma sessão autenticada e RLS/RPC existente, podendo filtrar uma loja.
- Envia ao modelo só a pergunta (com redator de credenciais/e-mails) e categorias resumidas de até 15 incidentes (código, estado, recorrências e momento). **Não** envia dados pessoais, pedidos inteiros, nomes de lojas, valores ou IDs.
- Retorna hipóteses e orientações para o administrador. Sem reprocessar eventos, sem imprimir, sem finalizar pedido, sem movimentar dinheiro e sem executar código.
- O endpoint é sempre `POST /api/intelligence/analyze` no próprio domínio do Super Admin, não expõe tokens Cloudflare ao navegador.

## Permissões e limites

A API impede chamadas sem sessão válida, sem permissão de proprietário, de origens diferentes ou com parâmetros fora do limite. Não retorna mensagens técnicas do banco/Cloudflare ao usuário.

A inferência só ocorre após autorização e consulta bem-sucedidas. Cada pergunta faz no máximo uma inferência, com saída limitada pelo parâmetro `max_tokens`. Nenhuma chamada é agendada automaticamente.

A Cloudflare oferece **10.000 Neurons gratuitos por dia** no Workers AI (confira os limites e o consumo atual na conta). Atingir a franquia no Workers Free causa falha de inferência até a renovação diária, não uma promessa de uso ilimitado. Valores de hospedagem e serviços já existentes são independentes.

## Configuração de deploy

O `wrangler.admin.jsonc` já especifica:
- `main: cloudflare/admin-ai-worker.mjs`;
- `ai.binding: AI`;
- `assets.binding: ASSETS`;
- `assets.run_worker_first: ['/api/intelligence/*']`;
- variáveis públicas de conexão com o projeto Supabase **de produção**, com apenas a chave **publishable**, não `service_role`.

O build permanece `bash scripts/build-admin-cloudflare.sh` e a publicação, após aprovação/CI, permanece `npx --yes wrangler@4 deploy -c wrangler.admin.jsonc`. Nunca usar este arquivo de produção para publicar uma homologação apontada para outro banco. Para homologação, gerar outra configuração de implantação com URL e chave pública do ambiente **de testes**.

## Validações

`node --test tests/admin-intelligence.test.mjs`

Cenários: recursos estáticos acessíveis, anônimo bloqueado, gestor bloqueado, sessão expirada, origem inválida, mensagem inválida, ausência de binding e exclusão dos campos sensíveis antes da IA.

Testar também, em homologação, um login de Super Admin e um de lojista, os dois tipos de resposta (com e sem incidentes) e as rotas de ativos estáticos. Não publicar em produção se CI/build/fluxo de autorização falharem.

## Próximas etapas (não incluídas aqui)

Instrumentar logs do Windows e integrações, histórico auditável de diagnósticos, orçamento/rate limit robusto e catálogo de correções seguras com aprovação humana. **Não** oferecer reparo autônomo antes de trilhas de auditoria, rollback e testes de ponta a ponta.
