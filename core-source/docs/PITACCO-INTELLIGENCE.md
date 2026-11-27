# Pitacco Intelligence — diagnósticos assistidos, somente leitura

Esta entrega usa o **Cloudflare Workers AI** com o modelo `@cf/meta/llama-3.1-8b-instruct-fast`, aproveitando o banco de dados existente e sem serviço externo de IA cobrado por pergunta enquanto a franquia gratuita da conta não for ultrapassada.

## O que faz

- Acrescenta **Pitacco Intelligence** ao menu **Sistema** do Super Admin em `admin.pitacco.com.br`.
- Recebe uma pergunta do administrador, verifica a sessão no Supabase Auth e confirma `pitacco_is_platform_owner()` **no servidor**.
- Consulta a função já existente `pitacco_incidents()` com a mesma sessão autenticada e RLS/RPC existente, podendo filtrar uma loja.
- Envia ao modelo só a pergunta (com redator de credenciais/e-mails) e categorias resumidas de até 15 incidentes (código, estado, recorrências e momento). **Não** envia dados pessoais, pedidos inteiros, nomes de lojas, valores ou IDs.
- Para perguntas de contagem de lojas/assinaturas, consulta o resumo agregado `pitacco_subscription_overview()` do Supabase e responde com valores reais sem chamar a IA.
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

## Versão 2 — evidências operacionais agregadas

A função `public.pitacco_owner_diagnostic_snapshot(p_store uuid default null)` fornece um retrato de **contagens agregadas**, protegido por `pitacco_is_platform_owner()`. Lê registros existentes e não grava nem corrige operações.

- **Impressão Windows (24 h)**: estados `pending`, `claimed`, `saved`, `submitted`, `uncertain`, `error`; registra também espera superior a dez minutos e testes de impressora dos últimos sete dias. `submitted` significa envio ao spooler, **nunca confirmação de papel impresso**.
- **Avisos do entregador (24 h)**: status de habilitação do serviço, envios registrados, notificações pendentes, expiradas e com tentativas, sessões ativas registradas. `sent_at` não prova recebimento, som, vibração nem comportamento em segundo plano no Android.
- **iFood (24 h)**: eventos recebidos, processados, atrasados e em repetição. Evento `done_at` não prova que o iFood confirmou alteração de pedido.
- **99Food e Keeta (24 h)**: contagens de solicitações de aceite e de recusas registradas na plataforma. Não é um monitor da disponibilidade completa das APIs.

O painel apresenta a mesma janela e um horário de consulta, com filtro por loja. **Ausência de sinais não é garantia de operação saudável**, pois alguns processos não têm telemetria de aplicativo.

O Worker consulta esse resumo usando a sessão Supabase já verificada. Antes de chamar o modelo, copia exclusivamente campos explicitamente autorizados com números inteiros, booleanos e identificação da janela; jamais envia tokens do Firebase, logs brutos, clientes, endereços, GPS, identificadores de pedidos, recibos, nem nomes de lojas.

Se a consulta falhar, a IA deve informar que as evidências estão indisponíveis e continuar no modo consultivo com incidentes existentes, sem apresentar zeros inventados.

**Próxima fase, ainda não implementada:** correções com aprovação do proprietário, execução auditável, checagem de idempotência e rollback de configurações/código; teste físico de impressão e de áudio Android exigem dispositivo real. Não se deve oferecer botão de autocorreção até haver um executor validado.

A função deve estar aplicada no Supabase *antes* de disponibilizar os cartões do painel web. Em produção, testar que somente o Super Admin recebe dados; testar o portal do lojista sem autorização. Os testes de navegador e a implantação do Worker são passos distintos, ambos necessários.
