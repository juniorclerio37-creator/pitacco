# Regra de troco — checkout, lojista e entregador

## Checkout
Para pagamento em dinheiro na entrega, registrar valor total devido em centavos e perguntar 'Com quanto você vai pagar?'. Aceitar valor maior ou igual ao total, com opção 'Não preciso de troco'. Calcular troco em centavos: `max(0, valor_informado - total_devido)`. Validar no backend; não confiar em cálculo do navegador. Se valor informado for inferior ao total, impedir checkout ou solicitar correção. Valores do pedido devem refletir descontos, taxa de entrega e ajustes válidos.

## Painel do lojista
No card, detalhe e despacho do pedido, destacar **LEVAR TROCO — R$ X** quando `troco > 0`; exibir total, valor informado pelo cliente, meio Dinheiro e troco. Mostrar mesmo antes da alocação. Sinalização também no resumo para impressão do pedido, respeitando configurações de visibilidade. Não mostrar badge de troco quando o pedido está pago ou não precisa de troco.

## Pitacco Entregador
No card de alocação, lista, detalhe, rota e tela de cobrança, exibir **COBRAR NA ENTREGA — DINHEIRO**, total devido, 'Cliente pagará com R$ Y' e **LEVAR TROCO — R$ X** com destaque textual e visual. Exibir antes de aceitar e antes de sair da loja. Não esconder a informação em submenus.

## Finalização e conciliação
Confirmar código/PIN conforme origem do pedido, depois confirmar dinheiro recebido e troco entregue. Registrar valor recebido, troco efetivamente devolvido, horário e entregador em evento auditável. Não inferir pagamento a partir do PIN; nunca marcar pago antes da confirmação explícita do recebimento. Em divergência de valores, registrar ocorrência e manter pendência para a loja.

## Casos de teste
- Total R$ 42,90, cliente paga R$ 50,00 => levar troco R$ 7,10.
- Total R$ 42,90, cliente paga R$ 42,90 => não precisa de troco.
- Total R$ 42,90, cliente informa R$ 40 => rejeitar.
- Pedido pré-pago => nunca exibir cobrança ou troco.
- Alteração de total => recalcular troco e sincronizar antes da saída.
- Marketplace com dados de troco => usar dados oficiais recebidos, não inventar valor; se ausente, exibir 'troco não informado' e permitir esclarecimento pela loja.

## Status
A demonstração `entregador/index.html` apresenta exemplos fictícios; painel lojista, checkout e impressão ainda exigem integração real.
