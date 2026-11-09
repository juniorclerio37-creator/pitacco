# Pitacco 0.11.1 — gestor de pedidos

A interface passa a abrir em Pedidos, com quadro Em análise / Em preparo / Pronto / Em entrega, busca e Novo pedido no topo. Há uma lista separada de concluídos. A identidade Pitacco foi preservada.

Configurações reúne Impressoras (dispositivo, setores, fila), Aceite de pedidos e Alertas e aplicativo. O processamento de impressão e a sincronização continuam ativos ao navegar para outra área. O cadastro de loja pede somente o nome: plataforma e plano não são seleções obrigatórias. Integrações exibe o estado real das conexões ainda não implementadas. Lançamentos financeiros históricos ficam separados de pedidos operacionais.

## Atualizar a instalação existente
1. No SQL Editor do mesmo projeto Supabase, execute somente `updates/0.11.1/web/supabase/012_order_board.sql`. Não execute novamente INSTALAR-PITACCO.sql. A migração é incremental, preserva os dados e pode ser reaplicada.
2. Saia do Pitacco pela bandeja do Windows (fechar a janela apenas minimiza).
3. Execute o instalador 0.11.1 no mesmo usuário Windows. Não desinstale nem apague os dados do aplicativo. O identificador e o caminho da fila SQLite permanecem os mesmos.
4. Entre na loja. Em Pedidos, aceite um pedido próprio e depois use Marcar como pronto. Em retirada no balcão, use Confirmar retirada. Entregas seguem o fluxo existente: Em entrega reflete status retirada registrado pelo entregador.

A atualização SQL deve ser aplicada pelo proprietário no Supabase; a chave pública não permite executar migrações. Sem a migração 012, o quadro abre, mas o comando Marcar como pronto não funciona.

## Limites e validação
A lista mostra até 100 pedidos operacionais recentes; não é um relatório completo. Cancelados não aparecem nas colunas ativas. Pagamentos e marketplaces continuam sujeitos às limitações da versão 0.11. Nenhuma cobrança ou conexão foi adicionada pelo redesenho. Os botões de etapa chamam RPC autorizada e auditada; não imprimem novamente. Pedido ainda pendente não avança sem aceite.

Os testes de navegador usam somente dados fictícios e uma API simulada: não acessam a base de produção. A compilação e os resultados reais estão em Actions. A validação com impressora física continua necessária.

## Fontes
O checkpoint original permanece em source/*.b64. As alterações legíveis estão em updates/0.11.1/web/. O workflow reconstitui a base, aplica os arquivos e atualiza o número de versão antes de compilar. Nenhum arquivo da versão anterior foi excluído.
