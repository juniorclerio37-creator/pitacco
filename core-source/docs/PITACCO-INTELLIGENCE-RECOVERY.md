# Pitacco Intelligence v4 — pré-verificação de recuperação (Windows + entregadores)

## Objetivo

Mostrar ao Super Admin **evidências operacionais e impedimentos reais** antes de liberar qualquer correção executável. Esta versão não modifica pedidos, fila de impressão, impressoras, entregas, dados de clientes, credenciais FCM, agendamento ou configurações de push. Nenhuma recuperação ocorre apenas ao abrir o painel.

## Consulta de recuperação

A nova RPC `pitacco_owner_recovery_preflight(p_store uuid default null)`, disponível exclusivamente a sessões autenticadas com `pitacco_is_platform_owner()`, retorna somente:

- **Notificações Android:** status do envio em `courier_push_settings`, existência/atividade do cron `pitacco-courier-push`, existência do nome `pitacco_push_cron_secret` no Vault, presença das funções de protocolo nativo e quantidade de dispositivos válidos (inclusive nativos). **Nunca retorna** comando de cron, segredo, token Firebase, ID de dispositivo ou dados de entregadores.
- **Windows:** computadores registrados e ativos nos últimos 90 segundos, quantidade de computadores de impressão vinculados, trabalhos em erro ou aguardando há mais de 10 minutos nas últimas 24 horas e último teste declarado pelo operador (estado e momento, sem detalhes de impressora ou pedido).

A consulta exige as mesmas permissões do Super Admin que o Pitacco Intelligence. Funciona com todas as lojas ou filtro por loja. Usa somente SELECT; nenhuma fila é reclamada ou reiniciada.

## Verificação das credenciais reais da função de envio

A Edge Function isolada `pitacco-owner-push-readiness` confirma, exclusivamente a quem possui
sessão válida do **Super Admin**, se duas variáveis da função de envio estão presentes
e têm formato coerente:

- `PITACCO_FCM_SERVICE_ACCOUNT` (JSON com `project_id`, `client_email` e chave privada);
- `PITACCO_PUSH_CRON_SECRET` (segredo de autenticação usado no disparador).

Ela autentica o JWT com o serviço Auth do Supabase e verifica
`pitacco_is_platform_owner()` no banco sob o **token do usuário**, não como service_role.
Não retorna valores, e-mails, identificadores de projeto, tokens ou chaves; apenas booleanos.
Não chama Google nem altera a fila de entregas, o cron ou os dispositivos.

A tela `RecoveryPreflight.jsx` consulta essa função além da RPC de diagnóstico do banco.
Se a consulta estiver indisponível, exibe **Não verificado** e jamais considera o Firebase pronto.
Mesmo quando ambos os sinais forem positivos, só um teste real no Android em segundo plano
pode verificar se a entrega de notificações e o toque funcionam.

A implantação desta função é independente da função de envio `courier-push` e não a substitui.

O Worker do Pitacco Intelligence também consulta essa Edge Function usando a sessão
já autorizada do proprietário. Ele encaminha ao modelo **somente indicadores booleanos
permitidos explicitamente** (nunca o JSON bruto), e marca as informações como
indisponíveis se houver falha. Assim a pergunta sobre notificações funciona no chat
mesmo enquanto a atualização dos cartões visuais do Admin aguarda a implantação dos assets.

Seu endpoint exige autorização Supabase personalizada e aceita CORS somente de
`https://admin.pitacco.com.br`.

## Bloqueios antes de ativar o Firebase

A existência do segredo no Vault e do cron ativo **não garante** que `PITACCO_FCM_SERVICE_ACCOUNT` esteja configurado corretamente no ambiente da Edge Function. Nem a presença de token confirma áudio em segundo plano. Antes de propor o executor de ativação, confirmar:

1. Conta de serviço Firebase correta e API FCM HTTP v1 habilitada; não compartilhar credenciais.
2. Segredo do cron configurado em ambiente e Vault, com agendamento ativo.
3. APK estável corretamente assinado, sessão autorizada e dispositivo registrado.
4. Teste local do som, seguido de atribuição real com o app em segundo plano. Validação física no Android é imprescindível.

O servidor permanece desabilitado até a homologação. **Não** ativar globalmente o push apenas para remover o indicador de alerta. O banco não pode verificar o som nem garantir entrega após force-stop do Android.

## Impedimentos Windows

O teste de impressão só pode ser acionado e confirmado **no app Windows do estabelecimento**. A presença de um computador, ou `submitted` no spooler, não comprova papel impresso. Se estiver offline, abrir app e autenticar; confirmar computador vinculado; fazer teste de papel e registrar o resultado. Não reprocessar pedidos históricos em massa nem marcar `printed` automaticamente.

## Instalação e testes

A migração de protocolo nativo `20261118040000_pitacco_courier_native_voice_push.sql` deve existir antes desta versão.

Aplicar `supabase/migrations/20261118053000_pitacco_owner_recovery_preflight.sql` antes de publicar o Admin que importa `RecoveryPreflight.jsx`. Verificar negação para `anon` e para lojistas, e consulta com o token do Super Admin. A migração não agenda jobs e não altera o status do Firebase.

Não executar correções físicas a partir do navegador. O GitHub Actions do Admin requer credenciais Cloudflare e pode pular o deploy mesmo com build aprovado; confirmar os arquivos efetivos publicados por separado.
