# Validação da assinatura Asaas

A função `asaas-subscription-webhook` recebe `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED`. O token do webhook é obrigatório. Antes de registrar cobertura, a função consulta a cobrança no Asaas e confere situação, valor de R$ 59,90 e assinatura associada.

## Homologação com sandbox

1. Aplique as migrações de assinatura em um Supabase de homologação.
2. Configure a função com `ASAAS_ENVIRONMENT=sandbox`, `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN`. Use um token exclusivo para autenticar as notificações, igual ao cadastrado no webhook Asaas.
3. Configure o mesmo ambiente em `pitacco_private.subscription_control.asaas_environment`. Mantenha o bloqueio de pedidos desativado durante os testes.
4. Vincule uma assinatura oficial de teste à loja correspondente em `pitacco_private.asaas_subscription_bindings`. O vínculo usa ambiente, ID da assinatura no Asaas e UUID da loja.
5. Cadastre o endpoint `/functions/v1/asaas-subscription-webhook` no Asaas. Confirme que o pagamento altera a cobertura uma única vez mesmo se o evento for reenviado.
6. Valide a regularização pelo portal antes de ativar `enforce_new_orders`. Em produção, use `production`, credenciais de produção e vínculos daquela conta.

A criação da assinatura recorrente e a revisão de estornos e chargebacks ainda exigem os fluxos correspondentes do provedor. A função registra somente a confirmação consultada no Asaas e aceita somente assinaturas previamente vinculadas.

[Eventos de cobrança](https://docs.asaas.com/docs/webhook-para-cobrancas) · [Autenticação do webhook](https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook) · [Consulta de cobrança](https://docs.asaas.com/reference/retrieve-a-single-payment)

## Consultar uma cobrança no Pitacco Admin

Publique a função `asaas-homologation` no Supabase e configure `ASAAS_SANDBOX_API_KEY` com a credencial exclusiva do sandbox. Para um endereço separado de homologação, configure `PITACCO_HOMOLOGATION_ORIGIN` com a origem HTTPS desse painel. Essa configuração é independente da chave do webhook.

Em **Pitacco Admin → Homologação**, selecione a loja de teste e consulte o ID da cobrança no campo Asaas Sandbox. O resultado informa separadamente a confirmação no provedor e o registro no Pitacco. Salve a conclusão no histórico da área.
