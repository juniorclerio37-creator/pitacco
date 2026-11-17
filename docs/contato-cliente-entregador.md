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


## Atalhos do aparelho — 17/11/2026

- **Ligar** gera um link telefônico nativo com o número da entrega selecionada.
- **iFood com 0800 e localizador:** o discador recebe a sequência de dígitos do 0800, vírgula, dígitos do localizador, por exemplo `tel:08002005011,93898428`. O formato é uma tentativa de pausa/DTMF em discadores Android compatíveis. **Não é possível garantir que todos os celulares preservem ou disquem o sufixo automaticamente**. Por isso o app também mostra o localizador para copiar ou digitar durante a chamada.
- O botão não efetua uma ligação silenciosamente: o sistema operacional pode exigir que o entregador toque em ligar.
- **Google Maps / Waze:** o botão *Abrir rota* é disparado pelo toque real no pedido. O link universal carrega endereço ou coordenadas da entrega clicada, nunca da última rota. Sistemas com o app instalado podem abri-lo; caso contrário, o link abre a versão web.
- O endereço exibido no detalhe do pedido tem prioridade sobre a versão antiga no cartão. Coordenadas nulas, inválidas ou `0,0` não são usadas como destino.

## Identificação visível dos pedidos e localizador no cartão

Os dois painéis — **loja (Pedidos e Cozinha)** e **Pitacco Entregador (Pedidos)** — usam o mesmo critério de identificação:
- iFood, 99Food e Keeta: mostrar o **número público/curto da plataforma**, obtido de receipt.display_number, external_order_number, order_number ou display_id; **não** usar receipt.number como alternativa para a 99Food. Nunca mostrar IDs internos UUIDs nem números opacos de 13+ dígitos na 99Food.
- Balcão: B-(sequência), gerado no backend antes de salvar o pedido.
- Cardápio digital: D-(sequência), também gerado no backend.
- Sem número público válido: mostrar "Aguardando número", nunca um UUID cortado.

No iFood, o conector oficial recebe customer.phone.number, customer.phone.localizer e customer.phone.localizerExpiration, persiste contato/localizador somente na tabela privada pitacco_delivery_customer_contacts para entregas próprias e exclui esses campos do recibo geral. O código do telefone aparece em destaque nos cartões da loja e do motoboy quando disponível e não expirado; o mesmo código está visível no detalhe do pedido.

As funções pitacco_driver_card_badges e pitacco_merchant_order_badges verificam respectivamente o entregador ativo autenticado e o gestor/lojista/administrador da loja. Os códigos são retornados por pedido, sem expor o telefone bruto na lista geral.

A integração da 99Food deve mapear o número público oficial para receipt.display_number (ou external_order_number/order_number/display_id) e não para receipt.number ou deliveries.external_order_id quando estes forem IDs técnicos. Ainda não há homologação real de pedidos da 99Food ou Keeta neste conector.
