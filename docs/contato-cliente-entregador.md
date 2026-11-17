# Contato do cliente no Pitacco Entregador

Ao tocar no cartão, o entregador vê cliente, endereço, itens, complementos, observações e formas de contato disponíveis. WhatsApp só para telefone brasileiro real e válido; número intermediário 0800 é ligação, com localizador exibido separadamente. Não inventar telefone, localizador nem PIN.

Referência oficial iFood: https://developer.ifood.com.br/pt-BR/docs/guides/modules/logistics/details. O campo customer.phone pode conter number, localizer, localizerExpiration, e pode ser opcional; number pode ser real ou 0800.

## Mapeamento e segurança

A função public.pitacco_driver_order_detail consulta apenas pedidos ativos atribuídos ao entregador autenticado. O contato vem de uma tabela restrita a service_role (public.pitacco_delivery_customer_contacts) ou do receipt do pedido, e do telefone do checkout próprio quando existir. O receipt completo jamais é retornado ao app.

O conector iFood deve persistir os campos recebidos da API (customer.phone.number, customer.phone.localizer e customer.phone.localizerExpiration) somente pelo backend da integração, após verificar o vínculo delivery_id/store_id. Para 99Food e Keeta, mapear somente os campos realmente homologados pelas APIs; não pressupor que o telefone do cliente esteja disponível. Para pedidos próprios, o número pode vir do checkout.

Dados a persistir, quando disponibilizados pela plataforma:
- delivery_id e store_id verificados
- phone_number
- phone_localizer
- phone_expires_at

Nunca expor service_role ao painel ou ao app, nem usar contatos de pedidos para marketing. O localizador de ligação é diferente do código/PIN exigido para comprovar a entrega.

## Cenários de homologação

1. Pedido próprio com telefone real: WhatsApp + Ligar.
2. iFood com 0800 e localizador: Ligar + código em destaque; nunca WhatsApp.
3. Sem telefone ou telefone mascarado: não mostrar WhatsApp.
4. Com contato expirado: ações bloqueadas.
5. Entregador de outra loja, entregador desativado ou pedido concluído/cancelado: não retornar contato.
6. Mostrar os itens/complementos apenas quando a integração os fornecer; caso contrário, indicar indisponibilidade.

A infraestrutura está preparada, mas a importação dos contatos reais pelos conectores de marketplace ainda depende da homologação de cada integração. Não afirmar que os contatos estão sendo recebidos até verificar pedidos reais.
