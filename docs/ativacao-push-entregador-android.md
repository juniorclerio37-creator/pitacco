# Notificações do Pitacco Entregador no Android

O aplicativo usa o Firebase Cloud Messaging. O banco enfileira avisos de novas atribuições próprias para entregadores online. Antes de enviar, o servidor confere se a entrega continua atribuída, se o entregador segue online e se o aparelho ainda pertence à sessão autorizada. O aviso mostra apenas que há uma nova entrega.

## Ativação

1. No Firebase, cadastre o aplicativo Android `br.com.pitacco.entregador` e habilite a API Firebase Cloud Messaging HTTP v1. Grave o conteúdo de `google-services.json` no segredo de GitHub Actions `PITACCO_FIREBASE_ANDROID_JSON`. A compilação local aceita esse arquivo em `entregador/android-app/app/`; o Git ignora o arquivo.
2. No Supabase, configure `PITACCO_FCM_SERVICE_ACCOUNT` com a conta de serviço do mesmo projeto e permissão de envio pelo FCM. Configure `PITACCO_PUSH_CRON_SECRET` com um segredo exclusivo de alta entropia. Guarde esse mesmo valor em um segredo do Supabase Vault chamado `pitacco_push_cron_secret`.
3. Habilite Supabase Cron e `pg_net` se estiverem desativados. Crie o agendamento depois de publicar a função `courier-push` e configurar os segredos. A migração deixa o envio desligado até a conclusão da configuração.

```sql
select cron.schedule('pitacco-courier-push', '15 seconds', $schedule$
  select net.http_post(
    url := 'https://mdevzehqcpcgxspwbiyz.supabase.co/functions/v1/courier-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='pitacco_push_cron_secret')),
    body := '{}'::jsonb
  ) where exists(select 1 from vault.decrypted_secrets where name='pitacco_push_cron_secret');
$schedule$);
update pitacco_private.courier_push_settings set enabled=true;
```

4. Compile o APK com a configuração Firebase. Em um aparelho de testes, entre e habilite os avisos em **Ajustes → Ativar avisos no Android**. Teste com o aplicativo aberto, em segundo plano e com a janela fechada da tela de recentes. Teste também entregador offline, troca de conta, transferência e cancelamento da entrega antes do envio.

O Android usa o volume, a permissão e os ajustes do canal **Novas entregas** do aparelho. Dispositivos sem conectividade ou com notificações desativadas podem receber o aviso com atraso ou não receber. Após forçar a parada pelo sistema, reabra o aplicativo. A lista de pedidos sempre é consultada ao voltar ao painel.

## Pitacco Entregador 1.0.2 — notificações em segundo plano

O APK 1.0.2 usa FirebaseMessagingService com mensagem de dados de prioridade HIGH, recebida pelo Android mesmo quando o WebView está em segundo plano, desde que o aplicativo não tenha sido forçado a parar e o FCM esteja funcionando. O serviço publica uma notificação visível de alta importância, sem expor dados pessoais do pedido. O toque duplo foi recriado com maior intensidade percebida e vibração; ele usa o canal `Novas entregas • alerta forte` (`pitacco_new_assignment_loud_v2`). A nova versão do canal é necessária porque o Android não permite mudar o som de um canal existente.

No aplicativo, use **Ajustes → Ativar avisos no Android** e depois **Testar som de nova entrega** para disparar uma notificação nativa. Em **Configurar volume e notificações do Android** é possível abrir diretamente o canal de avisos para ajustar o volume do dispositivo e as permissões disponíveis.

**Limitações:** a plataforma Android controla o volume de notificações, o modo silencioso/Não Perturbe, a economia de bateria e a entrega de FCM. O Pitacco não altera essas preferências sem autorização e não consegue garantir o toque após uma parada forçada. O teste local comprova somente som/canal; é necessário testar uma atribuição real com o APK em segundo plano para validar o caminho completo.

**Requisitos de ativação no servidor:** sem `PITACCO_FCM_SERVICE_ACCOUNT`, `PITACCO_PUSH_CRON_SECRET`, `pitacco_push_cron_secret` no Vault, dispositivo registrado e cron ativo, não haverá push real. Não habilite `pitacco_private.courier_push_settings.enabled` antes da homologação completa da conta Firebase e do agendamento. A versão do servidor precisa enviar o campo de dados `kind=new_assignment` e o UUID `event_id`, sem conteúdo de clientes.
