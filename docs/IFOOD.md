# Recebimento de pedidos do iFood

## Preparação pelo proprietário

1. No Portal do Desenvolvedor iFood, configure a aplicação distribuída com acesso a autenticação, Merchant, Events e Order. Use o fluxo e a conta de testes oficiais.
2. Nos segredos da função Supabase `ifood-orders`, configure `IFOOD_DISTRIBUTED_CLIENT_ID` e `IFOOD_DISTRIBUTED_CLIENT_SECRET`. Gere também uma chave AES de 32 bytes codificada em base64 `IFOOD_TOKEN_KEY`. A chave AES deve permanecer estável durante a vida das credenciais gravadas. Mantenha esses valores fora do navegador.
3. Aplique `supabase/ops/ifood-cron.sql` no Supabase de destino com as extensões pg_cron e pg_net habilitadas. O agendamento consulta o iFood quando houver contas vinculadas e retoma eventos pendentes. O banco gera um código de chamada de uso único com validade de 25 segundos.
4. Abra **Pitacco Admin → Homologação → Homologação geral do iFood**, selecione a loja Pitacco de testes e autorize o ID no Portal do Parceiro. Envie um pedido de teste. Valide a chegada e o alerta nos dois dispositivos conectados. Registre o resultado de homologação. Após a liberação oficial, use **Liberar após homologação** para disponibilizar o vínculo às lojas.

Uma aplicação centralizada também pode receber eventos assinados na URL `/functions/v1/ifood-orders` se configurada separadamente, com `IFOOD_CLIENT_ID`, `IFOOD_CLIENT_SECRET` e IDs vinculados pelo proprietário no servidor. O webhook aceita somente contas centralizadas. O vínculo automático dos lojistas utiliza a aplicação distribuída.

## Loja

1. Abra **Integrações → iFood**, informe o Merchant ID da sua loja e gere o código de vínculo.
2. Autorize o Pitacco no Portal do Parceiro. Cole no Pitacco o código de autorização devolvido pelo portal. O Pitacco verifica a autorização do ID e inicia o recebimento.
3. Em **Pedidos** ou **Visão Geral**, clique em **Ativar som de pedidos** na sessão web. No aplicativo Windows, o aviso usa a notificação e o som da operação. A notificação requer o aplicativo conectado à loja e uma versão compatível.
4. Aceite e opere o pedido no **Gestor de Pedidos do iFood**. O Pitacco espelha os estados recebidos. Confirme o roteiro de homologação oficial antes da operação comercial.

O processamento confirma ao iFood o recebimento dos eventos já guardados na fila. O registro do pedido é idempotente. A autorização não é solicitada pela senha do lojista, e os tokens ficam criptografados no servidor.
