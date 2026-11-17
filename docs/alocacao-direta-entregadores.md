# Alocação direta e realocação — Pitacco Entregador

- Em entrega própria, o entregador não aceita nem recusa pedidos: a atribuição feita pela loja ou pelo motor de despacho é imediata e gera notificação. O primeiro comando do entregador é **Coletar pedido**.
- Estados: alocado -> coletado -> saiu para entrega -> confirmação de código/PIN e cobrança pendente -> entregue. A confirmação financeira é separada do estado logístico.
- O lojista pode **Trocar entregador** manualmente. Antes da coleta: transferência imediata atômica, com aviso aos dois entregadores. Após coleta/saída: exigir confirmação e motivo, com tratamento explícito de custódia e histórico de auditoria; não permitir que dois entregadores concluam o mesmo pedido.
- Reatribuição revoga permissão do entregador anterior imediatamente, inclusive em sessões com cache/offline; servidor valida versão de atribuição em toda transição.
- Notificar entregador novo; remover pedido ativo do anterior ao sincronizar. Se offline, reconciliar ao voltar sem duplicar pedido.
- Não permitir alocação de entregas parceiras dos marketplaces para entregadores próprios.
- Alocação automática exige entregador online, GPS recente, capacidade configurada, compatibilidade viária e rota ainda aberta. Alocação manual pode aceitar rota em direção oposta com aviso.
- Exibir cobrança, forma de pagamento e troco desde o card de atribuição. O entregador não pode editar o valor devido.

## Status
O protótipo web `entregador/index.html` foi alterado para **alocação direta sem Aceitar/Recusar**. Realocação e notificações reais ainda dependem de integração com backend e painel da loja.
