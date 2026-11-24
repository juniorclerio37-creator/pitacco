# Atalhos operacionais — revisão
- Novo Pedido direciona à rotina de venda já existente, que ainda é de lançamento manual simplificado. Para cumprir o fluxo aprovado, integrar catálogo, complementos, clientes, frete cotado, desconto, pagamento/troco, estoque e Fideliza+ por operação transacional; não anunciar como pronto.
- Aceite altera as origens já habilitadas, sem habilitar marketplace não integrado. Testar modos parciais e concorrência.
- Alocação usa set_dispatch_policy, preservando limite por viagem. Testar atualização entre painel e Windows e worker ativo.
- Impressão: proposta SQL separada, ainda não aplicada. Validar reprint_order, request_id, gatilhos de aceite, fila antiga, idempotência e autorização. Não publicar UI como funcional antes disso.
- Assinatura: o catálogo comercial atual no repositório foi alterado para plano único (migração 20261117003000) e o mecanismo de pagamentos aceita somente 59,90. O plano Grátis (5% semanal) e Completo (59,90 mensal) precisam ser reconciliados com o backend, Asaas, cobrança semanal, comprovantes, auditoria, módulos e bloqueio antes de permitir mudanças reais. A interface atualizada não modifica cobranças nem exibe uma contratação fictícia.
- Validar CI, build web/Windows, permissões por loja e ambiente de homologação antes de publicar.
