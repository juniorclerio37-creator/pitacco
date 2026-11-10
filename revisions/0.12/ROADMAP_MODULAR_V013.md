# Pitacco — plano modular após v0.13

## Princípios
- Preservar os fluxos existentes e não disparar instalador Windows.
- Menu principal enxuto; funções avançadas em abas por módulo, sem painéis misturados.
- Alterações de banco aditivas, com RLS por loja, permissões no backend e migrações reversíveis quando possível.
- Não ativar recursos incompletos no fluxo de pedidos em produção; usar feature flags por loja.
- Manter compatibilidade com iFood, 99Food, Keeta e cardápio próprio; sem presumir APIs homologadas.
- Nunca assumir que pedidos de marketplace incluem dados de clientes ou repasses que não foram fornecidos.
- Testes automatizados antes de disponibilizar; testes físicos de impressão no Windows exigem ambiente real.

## Navegação
1. Visão Geral — poucos indicadores e alertas críticos.
2. Pedidos — abas Recebidos, Preparo, Entregas e Agendados. Despacho e rotas ficam aqui.
3. Motoboys — Cadastro, Regras de pagamento, Acertos e Histórico. Sem despacho.
4. Meu Cardápio — Produtos, Complementos, Estoque e Fichas técnicas.
5. Clientes — Cadastro, Histórico e Segmentos.
6. Fideliza+ — Pontos, Cupons, Cashback, Campanhas, Indicações e Recompensas.
7. Financeiro — Visão financeira, Lucro por pedido, Conciliação, Despesas e Relatórios.
8. Integrações — Canais, credenciais autorizadas, status e erros.
9. Administrar Loja — Dados, Impressão, Equipe e permissões, Alertas e diagnóstico.

## Ordem de implementação
### Fase A: segurança e estabilidade (bloqueante)
- Corrigir e executar compilação React e testes do fluxo pedido -> aceite -> fila de impressão.
- Deduplicar eventos e impressão com chaves únicas e operações atômicas no banco.
- Permissões: papéis proprietário, gerente, operador, cozinha, financeiro e entregador; matriz de permissões aplicada via RPC/RLS, com auditoria.
- Alertas: fila de eventos, atrasos por SLA, confirmação de leitura e diagnóstico por loja; notificação Windows sem depender do navegador aberto.

### Fase B: estoque e clientes
- Insumos: unidade, fator de conversão, estoque mínimo, custo, movimentações imutáveis e ajuste auditado.
- Ficha técnica versionada por produto e complementos; baixa idempotente ao marco operacional definido; estorno em cancelamentos.
- Cadastro e histórico de clientes apenas com dados disponíveis e uso permitido; consentimentos para marketing, retenção e controle de acesso.

### Fase C: pedidos agendados
- Disponibilidade por loja, horário, capacidade, antecedência, fuso e feriados.
- Reserva no checkout próprio, confirmação e ativação automática com idempotência; alterações e cancelamentos auditados.
- Marketplaces: só integrar quando a plataforma permitir e homologar.

### Fase D: conciliação e relatórios
- Importação de extratos/arquivos e integrações autorizadas; casar repasses a pedidos, taxas e descontos.
- Divergências, pagamentos pendentes, ajustes e comprovantes; não confundir faturamento com repasse ou lucro.
- Exportação CSV/PDF filtrada por loja, período, plataforma, produto e entregador.

### Fase E: Fideliza+ avançado
- Ledger de pontos e cashback, saldo calculado no backend, operações atômicas e expiração.
- Cupons com regras, limites, unicidade de resgate, prevenção de fraude e auditoria.
- Indicação, campanhas e recompensas com elegibilidade e permissões de comunicação.

## Critérios de aceite
- Isolamento entre lojas e proteção contra acessos indevidos testados.
- Nenhum pedido, pagamento, impressão ou resgate duplicado sob repetição/reconexão.
- Valores de motoboy por km só com rota viária verificada loja -> cliente, sem retorno.
- Fichas técnicas e conciliação não alteram retroativamente históricos financeiros.
- Cada tela apresenta apenas tarefas do módulo, com filtros e detalhes sob demanda.
- Não gerar instalador Windows até autorização explícita.
