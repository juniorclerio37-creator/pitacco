# Shipping iFood — homologação

Fluxo pretendido: entrega própria continua disponível. O lojista pode cotar a logística iFood para pedido iFood ou próprio e confirmar o valor antes de contratar. HTTP 202 não confirma a alocação. As operações de escrita ficam indisponíveis até serem integradas com a reserva atômica da entrega local e os eventos oficiais.

Primeira etapa implementada: construtor de requisições, 11 testes unitários de contratos, Edge Function de consulta limitada a loja de teste centralizada, cotação interna/externa e consulta do pickupCode, tela no Super Admin. O acesso ao contexto do banco é exclusivamente service_role e o servidor verifica o gestor/proprietário e o estabelecimento de testes. Não há contratação comercial.

Teste real: GET /shipping/v1.0/merchants/{merchantId}/deliveryAvailabilities retornou HTTP 400, código DeliveryDistanceTooHigh. A consulta chegou à API, mas não obteve cotação válida. A loja de teste não possuía pedido de entrega própria elegível no momento da consulta. Para prosseguir, obter endereço aceito pelo iFood e pedido de teste elegível. Não declarar o cenário como homologado.

Pendências: persistir cotações, bloquear concorrência com entregador próprio e alocação automática, solicitar entregador e criar pedido externo com retorno assíncrono, persistir eventos Shipping deduplicados, tratar alteração de endereço e cancelamento com motivos dinâmicos, validar o fluxo integrado na loja de teste, documentar logs e vídeos.

Referências: https://developer.ifood.com.br/pt-BR/docs/food/guides/modules/shipping/intro
