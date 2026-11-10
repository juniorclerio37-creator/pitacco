# WhatsApp por estabelecimento — cardápio digital Pitacco

## Navegação
Administrar Loja > WhatsApp. Cada lojista conecta seu número autorizado e define os textos e etapas que deseja notificar. Identidade e escopo da loja devem ser verificados pelo backend.

## Eventos
- accepted: pedido aceito
- preparing: pedido em preparo
- ready: pedido pronto
- out_for_delivery: saiu para entrega (link de rastreamento individual)
- ready_for_pickup: pronto para retirada
- delivered: entregue

Pedidos para retirada não recebem 'saiu para entrega'; pedidos para entrega não recebem 'pronto para retirada'. A notificação só é disparada após mudança de estado persistida e validada. Uma mensagem por loja/pedido/evento, com idempotência e retries.

## Textos
- Loja personaliza modelos por evento, com prévia e variáveis seguras: {{nome_cliente}}, {{nome_loja}}, {{numero_pedido}}, {{link_rastreio}}.
- Ativar/desativar cada evento.
- Texto padrão restaurável; evitar incluir informações sensíveis.
- Regras e aprovação de templates WhatsApp devem ser respeitadas; texto livre não garante aprovação para envio automático.

## Segurança e privacidade
- Usar API oficial WhatsApp Business Platform (Cloud API ou provedor autorizado).
- Consentimento explícito para receber notificações e mecanismo de descadastro.
- Segredos e tokens somente no servidor; nunca em frontend, Supabase público ou logs.
- Link de rastreamento exclusivo, temporário e não enumerável; apenas durante entrega, com encerramento após conclusão.
- Atualização de GPS só mediante permissão do entregador e política de privacidade; não enviar localização bruta no WhatsApp.
- Não enviar notificações para pedidos iFood, 99Food ou Keeta neste fluxo, salvo futura integração expressamente autorizada.

## Operação
- Backend registra eventos em outbox transacional, worker envia e reconcilia entrega/falhas, retries limitados e deduplicação.
- Dashboard de conexão, último envio, erros, templates pendentes de aprovação.
- Desconexão e revogação imediatas; desconectar não deve apagar pedidos.
- Métricas por loja e monitoramento agregado do proprietário sem exposição de conteúdo privado.

## Implementação
Migração 021 adicionada ao repositório, mas não aplicada.
Ainda pendentes: interface de conexão, onboarding oficial, RPCs, worker de envio, disparo transacional no pedido, geração de rastreio, testes ponta a ponta.
