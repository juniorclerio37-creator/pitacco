# Pitacco Entregador — homologação de notificações em segundo plano

Estado diagnosticado em 20/11/2026: a Edge Function **courier-push** está implantada, porém o teste assinado pelo segredo no Supabase Vault devolveu HTTP **503 / FCM ainda não configurado**. O segredo **pitacco_push_cron_secret** já existe no Vault. A configuração **pitacco_private.courier_push_settings.enabled** está **false**, e o job **pitacco-courier-push** está **inativo**. Nenhum aparelho tinha um token FCM registrado ao fazer a auditoria.

## Credencial pendente — ação do proprietário no dashboard

1. Abrir o **projeto Firebase já utilizado pelo Pitacco Entregador**, sem criar outro projeto.
2. Em **Configurações do projeto → Contas de serviço (Service accounts)**, gerar/baixar uma **chave privada do Firebase Admin SDK**, em JSON. Esta NÃO é o arquivo público de configuração do Android `google-services.json`.
3. Abrir **Supabase → Projeto Pitacco → Edge Functions → Secrets**. Salvar o conteúdo do JSON como valor completo do segredo:
   `PITACCO_FCM_SERVICE_ACCOUNT`.
4. Não incluir o JSON em arquivos do GitHub, commits, mensagens, Android, cardápio, Cloudflare Worker ou SQL exposto. Revogar/rotacionar a chave no Google Cloud se ela tiver sido compartilhada indevidamente.
5. A identidade de projeto `project_id` da conta de serviço precisa ser a **mesma** da configuração oficial do Firebase Android que o workflow GitHub `PITACCO_FIREBASE_ANDROID_JSON` utiliza.

A função `courier-push` tem o modo `{"action":"preflight"}`: exige o **Bearer exclusivo do Vault/pg_cron**, testa a obtenção de um token OAuth no Google e responde apenas `{"ready":true,"oauth":"authorized","dispatched":false}`. Não reclama pedidos, não notifica clientes, não expõe tokens e **não deve ser publicada como endpoint anônimo**.

**Somente após HTTP 200 nesse teste**, executar com acesso de administrador ao banco:

```sql
update pitacco_private.courier_push_settings
set enabled=true where singleton=true;

select cron.alter_job(
  (select jobid from cron.job where jobname='pitacco-courier-push'),
  active := true
);
```

O agendamento original é a cada 15 segundos. Não criar uma segunda agenda nem recriar o projeto Firebase. Se o teste de credencial falhar, manter ambas as configurações desativadas.

## Homologação de ponta a ponta

1. Publicar o APK estável oficial **2.0.13** somente após preflight e assinatura aprovados. A compilação `-TESTE-PARALELO` usa ID de app diferente e, propositalmente, não possui FCM de produção.
2. No Android, **instalar por cima** do Pitacco Entregador (mesmo `br.com.pitacco.entregador`). Fazer login, autorizar notificações e deixar o app **online**. O Android renova o token FCM automaticamente ao retornar das permissões.
3. Conferir com SQL sem imprimir tokens: `select count(*) from pitacco_private.courier_push_device where expires_at>now();`. Deve passar a existir ao menos um dispositivo, cadastrado pela RPC `pitacco_register_courier_push_native` com protocolo `data_only`.
4. Atribuir pedido de **entrega da loja** ao entregador autorizado. Validar tanto a loja principal quanto a loja secundária permitida via `pitacco_courier_test_access`. O gatilho e o claim já aceitam essa relação na base de produção.
5. Testar com app em primeiro plano, minimizado, tela bloqueada e com Waze/Google Maps aberto. Esperado: notificação Android + som aprovado. Reabrir o app pelo aviso e confirmar o pedido.
6. Testar sem internet e permissões negadas. O sistema deve mostrar o motivo correto; o app não pode prometer áudio garantido sob **Não Perturbe**, forçar parada do aplicativo, perda de rede ou economizador de bateria.
7. Testar offline e logout. O GPS de plantão pára automaticamente ao ficar offline; ao **sair da conta**, a inscrição de notificações deve ser revogada e o sinal nativo desativado.
8. Verificar que o status no banco permanece correto e que duplicatas do mesmo evento não tocam duas vezes.

Para checar apenas configuração, consulte: `pitacco_private.courier_push_settings`, `cron.job`, `pitacco_private.courier_push_device` e respostas da Edge Function. Não grave informações de clientes, credenciais ou tokens nos logs de diagnósticos.

**Bloqueador de publicação em 20/11/2026:** segredo FCM de servidor ausente. Não declarar alertas reais em segundo plano funcionando nem ativar cron antes de corrigir isso.
