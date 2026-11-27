# Pitacco — ativação final de Web Push

## O que está implantado

- Banco: `public_order_push_subscriptions` com RLS; `public_order_push_events` com fila, deduplicação e tentativas.
- Gatilhos: `pitacco_orders_push_trigger` e `pitacco_deliveries_push_trigger`.
- RPC pública: `pitacco_track_public_order` e `pitacco_register_order_push`, exigindo token de acompanhamento.
- Edge Functions publicadas: `push-public-config` (configuração pública) e `push-send-queued` (envio protegido por service role).
- Site: `/acompanhar/?token=...` e `/sw.js`, incluídos no build Cloudflare.

## Ativação necessária no Supabase

1. Gerar um par VAPID em um computador confiável com `npx web-push generate-vapid-keys`. Nunca colocar a chave privada no repositório, no navegador, no chat ou em uma variável pública.
2. No painel Supabase > Edge Functions > Secrets, cadastrar:
   - `PITACCO_VAPID_PUBLIC_KEY`: chave pública gerada.
   - `PITACCO_VAPID_PRIVATE_KEY`: chave privada gerada.
   - `PITACCO_VAPID_SUBJECT`: endereço de contato válido, por exemplo `mailto:suporte@pitacco.com.br` **somente se esse e-mail existir**.
3. Confirmar que a variável protegida `SUPABASE_SERVICE_ROLE_KEY` está disponível às Edge Functions (nunca enviar ao frontend).
4. Agendar execução recorrente de `POST https://mdevzehqcpcgxspwbiyz.supabase.co/functions/v1/push-send-queued` usando autorização `Bearer <SUPABASE_SERVICE_ROLE_KEY>` **apenas no servidor**. Recomendado: a cada minuto. Usar Supabase Cron com segredo no Vault ou agendador seguro equivalente; jamais colocar essa chave em SQL público ou GitHub.
5. Confirmar publicação da versão mais recente do branch `main` no Cloudflare Pages, inclusive a rota `/sw.js`.
6. Testar pedido próprio em Android Chrome e iOS instalado na Tela de Início: autorizar notificações, fechar a página, mudar status no painel e confirmar recebimento.

## Limitações e segurança

- O navegador exige consentimento explícito. iOS exige instalação do site na Tela de Início para Web Push.
- A chave VAPID pública pode aparecer no cliente; a privada jamais.
- Não usar números de pedido como segredo: o token de acompanhamento é privado e tem expiração.
- Web Push não cobra por mensagem, mas serviços de hospedagem/execução podem cobrar por consumo.
- Se não houver VAPID ou agendamento, o acompanhamento continua funcionando, mas push em segundo plano não será entregue.
- O envio está limitado a provedores de push conhecidos; ampliar a lista exige revisão de segurança.
