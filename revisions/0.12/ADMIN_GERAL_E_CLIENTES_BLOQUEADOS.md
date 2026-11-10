# Administração Geral e bloqueios por loja

## Mesmo aplicativo, papéis diferentes
- Aplicativo compartilhado, navegação condicionada à identidade autenticada no backend.
- Proprietário Pitacco: Administração Geral (todas as lojas, monitoramento, assinaturas, inadimplência, suporte consentido).
- Lojista: operações e configurações exclusivamente das lojas às quais pertence.
- Proprietário pode suspender/reativar serviço por regras contratuais, sem isso conceder acesso para alterar dados operacionais da loja.
- O bloqueio por inadimplência não apaga dados nem interrompe pedidos já aceitos; libera regularização e suporte.
- Reativação automática só após confirmação confiável de pagamento pelo backend. 7 dias gratuitos uma vez por estabelecimento; plano único R$ 59,90/mês, pedidos e entregadores ilimitados.
- Status online, aberta/fechada e vendas são indicadores distintos; usar eventos reais e timestamps de atualização.

## Administrar Loja > Clientes bloqueados
- Bloquear por nome, telefone ou endereço com justificativa, validade e auditoria.
- Normalizar telefone com DDD; endereço com logradouro, número e complemento.
- Evitar bloqueio falso por homônimos, endereços coletivos ou dados incompletos: nome/endereço isolados devem requerer confirmação adicional e mecanismo de revisão.
- Loja pode listar, revogar e consultar bloqueios somente da própria loja.
- Validar no checkout do cardápio próprio no servidor, antes de criar pedido, sem expor regras ao cliente.
- Marketplace: somente quando houver suporte e permissão oficiais; não prometer bloquear pedidos iFood/99Food/Keeta.
- Restringir coleta, acesso e retenção de dados pessoais ao necessário; proteger justificativas e registros de auditoria.
- Mensagem ao cliente deve ser neutra, com canal de contato da loja para contestação.
- A decisão não pode ser baseada em atributos protegidos ou discriminatórios.

## Estado atual
- Criada migração `020_customer_blocks.sql` com isolamento por loja, auditoria básica e leitura restrita.
- Ainda não há RPC de criação/revogação nem verificação transacional no checkout.
- Ainda não há interface de bloqueio no app ou bloqueio por inadimplência implementado neste conjunto de alterações.
- Não afirmar que o recurso está funcionando até migrações, políticas e testes de integração serem aplicados.
