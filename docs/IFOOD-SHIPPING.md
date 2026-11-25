# Shipping iFood — homologação

Fluxo pretendido: entrega própria continua disponível. O lojista pode cotar a logística iFood para pedido iFood ou próprio e confirmar o valor antes de contratar. HTTP 202 não confirma a alocação. As operações de escrita ficam indisponíveis até serem integradas com a reserva atômica da entrega local e os eventos oficiais.

Primeira etapa implementada: construtor de requisições, 11 testes unitários de contratos, Edge Function de consulta limitada a loja de teste centralizada, cotação interna/externa e consulta do pickupCode, tela no Super Admin. O acesso ao contexto do banco é exclusivamente service_role e o servidor verifica o gestor/proprietário e o estabelecimento de testes. Não há contratação comercial.

Teste real: GET /shipping/v1.0/merchants/{merchantId}/deliveryAvailabilities retornou HTTP 400, código DeliveryDistanceTooHigh. A consulta chegou à API, mas não obteve cotação válida. A loja de teste não possuía pedido de entrega própria elegível no momento da consulta. Para prosseguir, obter endereço aceito pelo iFood e pedido de teste elegível. Não declarar o cenário como homologado.

Pendências: persistir cotações, bloquear concorrência com entregador próprio e alocação automática, solicitar entregador e criar pedido externo com retorno assíncrono, persistir eventos Shipping deduplicados, tratar alteração de endereço e cancelamento com motivos dinâmicos, validar o fluxo integrado na loja de teste, documentar logs e vídeos.

Referências: https://developer.ifood.com.br/pt-BR/docs/food/guides/modules/shipping/intro

## Evolução da homologação
A solicitação interna via requestDriver foi conectada à função de teste. A cotação fica registrada no banco e a confirmação reserva a entrega, impedindo a alocação local. HTTP 202 não muda o operador; apenas eventos oficiais REQUEST_DRIVER_SUCCESS/ASSIGN_DRIVER confirmam. Falha inequívoca libera a reserva; resultado incerto exige conciliação. Testes SQL transacionais passaram para cotação, reserva, duplicidade, bloqueio, rejeição, 202 pendente, confirmação por evento, evento repetido/atrasado e conclusão. O polling centralizado de teste foi conectado ao agendamento existente de 30 segundos; processamento e deduplicação precedem acknowledgment. O console e a escolha de entrega no diálogo do PDV são limitados a pedidos iFood de teste. A criação externa, alteração de endereço e cancelamento Shipping ainda não estão expostos em operação, apesar dos construtores de requisição. Não liberar comercialmente antes dos cinco cenários oficiais.

## Revisão de polling — 25/11/2026
O agendamento cron de 30 segundos estava efetivamente produzindo intervalos de cerca de 60 segundos no log de Shipping. A função de liberação de lease passou a agendar a próxima janela do relógio de 30 segundos, mantendo exclusão concorrente e backoff em falha. Também foi adicionada uma verificação de conclusão durável de eventos Order antes de acknowledgment no polling Shipping, inclusive em eventos duplicados ainda pendentes. Validar intervalos reais após a migração e testar eventos reais antes de gravar. Relatório anterior (Order/Events via WEBHOOK) de 60/60 não comprova homologação Shipping. O cenário externo continua pendente de cotação válida e de implementação de criação, alteração de endereço e cancelamento.
