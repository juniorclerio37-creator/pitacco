# Cobrança na entrega — Pitacco Entregador

## Requisitos de interface
- Todo card deve exibir estado financeiro persistente e explícito: **COBRAR NA ENTREGA** (laranja com valor e meio) ou **PEDIDO PAGO — NÃO COBRAR** (verde). Não depender somente de cor ou ícone; texto visível também em listas e detalhes.
- Exibir valor **exato a cobrar do cliente** (não confundir com remuneração do entregador), meio de pagamento (dinheiro, débito, crédito, Pix quando permitido), troco solicitado e observações.
- Estado desconhecido/divergente: **PAGAMENTO A CONFERIR**, nunca inferir pago nem cobrar duplicado.
- Mostrar cobrança já na alocação e nos detalhes; repetir após código de entrega validado.

## Máquina de estados
`delivery_confirmation_status` separado de `payment_status`: pending/confirmed/failed e unpaid/pending_confirmation/paid/disputed. Código confirmado não significa pagamento recebido. Entrega própria marketplace deve seguir requisitos oficiais de confirmação.

Ao solicitar conclusão:
1. Confirmar PIN/código via backend e integração autorizada quando exigido.
2. Se pagamento já confirmado pelo provedor, concluir sem cobrança.
3. Se pagamento na entrega pendente, exibir tela bloqueante com total e forma de pagamento.
4. Dinheiro: registrar valor entregue e troco devido, com confirmação explícita. Cartão por maquininha externa: entregador confirma transação aprovada, identificando método e referência quando disponível. Pix online: somente webhook/verificação do provedor pode confirmar pagamento, nunca botão local.
5. Se cobrança não ocorreu, registrar ocorrência e manter pagamento pendente; não permitir status financeiro pago. Conclusão logística excepcional, se necessária, deve ser controlada pelo lojista com auditoria e nunca esconder pendência.
6. Idempotência e transações atômicas para impedir dupla cobrança e dupla conclusão. Histórico financeiro com origem da confirmação e horário.

## Segurança e consistência
- Não confiar em campos enviados pelo cliente Android/web para valor, forma ou estado financeiro. Buscar dados do pedido no backend, conferir atualizações e autorizações por loja e entregador.
- Atualizações de status de marketplace e de pagamento devem ser conciliadas por webhooks com validação de assinatura, e política de expiração/retry.
- A entrega não deve sumir da lista sem confirmação de estado, inclusive após queda de conexão.
- Testes: pago, dinheiro com troco, débito/crédito recusado, Pix pendente, cobrança parcial, estado desconhecido, código inválido, timeout, duplicação, troca de entregador.

## Situação da demonstração
O arquivo `entregador/index.html` exibe estados simulados de pago/cobrar e exige confirmação fictícia após PIN fictício 1234. **Não processa pagamentos nem confirma marketplace**. Os pedidos e valores são fictícios.
