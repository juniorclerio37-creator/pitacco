# Integração central WhatsApp — implantação

## Arquitetura aprovada
Um único aplicativo Meta administrado pelo Pitacco; cada loja autoriza o próprio WhatsApp Business. Nenhuma loja configura token ou webhook. Os identificadores públicos da conexão ficam em store_whatsapp_connections, com RLS por loja. Credenciais de acesso, assinatura de webhook e OAuth ficam somente no backend.

## Arquivos
- 021_whatsapp_notifications.sql — preferências e fila de mensagens
- 022_whatsapp_settings_rpc.sql — RPC para salvar preferências com validação de loja
- 023_whatsapp_connections.sql — vínculo Meta por loja e status
- WhatsAppSettings.jsx — botão de conexão, status, personalização e histórico

## Fluxo obrigatório antes de produção
1. Pitacco cadastra e verifica o app Meta e conclui habilitação para onboarding de empresas de terceiros (Embedded Signup/Tech Provider, conforme elegibilidade).
2. Backend implementa endpoint autenticado `whatsapp-connect-start`, verifica associação do usuário à loja e cria estado anti-CSRF de uso único com expiração curta.
3. Frontend inicia Embedded Signup com SDK oficial e configuração do app Meta; callback recebe código de autorização e identificadores WABA/número, nunca token persistente.
4. Backend valida estado, troca código no servidor, valida permissão e titularidade do WABA/número, inscreve webhooks e salva vínculo em `store_whatsapp_connections`.
5. Segredos no gerenciador de segredos do Supabase: app secret, tokens e webhook verify token. Nunca guardar segredos em tabela pública ou bundle.
6. Worker envia templates aprovados usando número da loja. Registrar consentimento e opt-out, conferir origem própria do pedido, deduplicar por evento e tratar retries, limites e erros.
7. Webhook deve verificar `X-Hub-Signature-256` e reconciliar status da entrega da mensagem. Desconectar revoga acesso.
8. Link de rastreio deve ser curto, exclusivo por pedido, expirar ao entregar e nunca expor coordenadas após conclusão.

## Migrações
Executar as migrações pendentes na ordem numérica pelo Supabase SQL Editor ou CLI após backup e verificação do esquema. Não executar 023 antes de 021 e 022. A conexão do app Meta e o envio real NÃO estão ativados apenas pela aplicação dos SQL.

## Importante
O botão de conexão no frontend chama `whatsapp-connect-start`. Sem essa Edge Function instalada, ele mostra erro e não cria uma conexão falsa. O fluxo Meta e os envios ainda precisam ser implementados e homologados com credenciais oficiais.
