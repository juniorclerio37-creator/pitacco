# Painel Central Pitacco — contrato de segurança e operação

## Papéis
- Proprietário da plataforma: identidade autenticada em `platform_owners`, atribuída somente no servidor.
- Gestor da loja: pode administrar somente estabelecimentos onde possui vínculo autorizado.
- Operador: permissões específicas, sem acesso a lojas de terceiros.

## Visão global (somente leitura)
- Lojas cadastradas e seus status: aberta/fechada, último sinal de conexão, pedidos recebidos, pedidos concluídos e faturamento por período.
- Indicadores de ausência de vendas devem mostrar o intervalo consultado; 'sem vendas' não significa offline.
- Status de assinatura: teste, ativa, vencida, regularização; atualização conforme eventos confirmados pelo servidor.
- Atualização em tempo real via canais de eventos autorizados por RLS, com reconciliação periódica e indicadores de conexão.
- Acesso global à telemetria não concede automaticamente permissão de alteração em loja.

## Pedido de suporte
1. Proprietário escolhe loja, escopos e descreve motivo.
2. Servidor cria solicitação pendente; nenhum acesso de escrita é concedido.
3. O aplicativo do lojista exibe modal com motivo, escopos, validade e opções Autorizar/Recusar.
4. Decisão do gestor é persistida no servidor e entregue em tempo real ao painel central.
5. Autorizar emite autorização de curta duração e escopo limitado; recusar bloqueia.
6. Revogar ou expirar invalida imediatamente futuras alterações.
7. Cada mutação exige revalidação no servidor da identidade do proprietário, loja, escopo, validade e status; auditoria transacional com antes/depois.
8. Pedidos pendentes ou recusados nunca podem ser interpretados como autorização.
9. Nenhuma credencial, token de marketplace, senha, PIN ou dado sensível deve aparecer no painel central ou nos logs.

## Separação
- Não usar apenas estados React ou campos editáveis pelo cliente para autorizar.
- Não reutilizar `admin` genérico como papel de proprietário.
- Os indicadores globais devem ser agregados no servidor e não abrir acesso irrestrito a pedidos com dados pessoais.
- A permissão de suporte não altera a titularidade dos dados do lojista.
- O proprietário pode consultar a saúde operacional global; alterações em loja requerem consentimento específico.
- Situações de emergência ou manutenção sem consentimento exigem fluxo administrativo separado, previamente definido em contrato e com auditoria; não são implementadas aqui.

## Status de implementação
- Migração 019: tabelas, papéis e leitura segura; **não aplicada**.
- Pendentes: RPCs transacionais de solicitação, decisão, revogação e alteração autorizada; modal em tempo real, dashboard de indicadores, teste RLS de isolamento e testes entre computadores.
- Não habilitar edição remota até que todas as validações e testes de segurança estejam concluídos.
