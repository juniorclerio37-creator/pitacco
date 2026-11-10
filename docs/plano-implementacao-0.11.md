# Plano de melhorias na base existente Pitacco 0.12

## Estado conhecido
A versão de trabalho permanece 0.12, conforme `revisions/0.12/restore.py` e `.github/workflows/windows.yml`. Não criar versão nova nem alterar o número de versão sem autorização. Não foi encontrada ramificação 0.13 na verificação de 10/11/2026. O código do checkpoint está em `source/*.b64` como ZIP particionado. Não editar artefatos compactados diretamente. Recuperar, verificar SHA-256 conforme workflow existente, executar testes, alterar fonte, reconstruir pacote e atualizar verificação apenas depois de confirmar a integridade. Não declarar executável homologado: Windows sem assinatura Authenticode.

## Ordem de entrega
1. Impressão Windows (#10): reproduzir erro com 80 mm, capturar código e logs, confirmar permissões e nome da impressora, corrigir fila SQLite e adaptadores Tauri, permitir vincular/editar/excluir/testar impressora por loja, templates HTML sanitizados, status distintos enviado ao spooler / impresso confirmado, reimpressão auditada.
2. Idempotência (#11): chave única por loja+origem+ID de pedido, transação/índice único, retries e reconexão, spool único por pedido+destino+versão, sem perder reimpressão explícita.
3. Clientes (#3) e bloqueios (#1): cadastro por loja, auditoria e checagem de bloqueio no servidor antes de criar pedido próprio. Evitar bloqueio automático baseado apenas em telefone não verificado.
4. Pedidos agendados (#5), permissões (#7), estoque (#2).
5. Conciliação (#4), relatórios (#6), pagamentos de motoboys (#12).
6. Alertas (#8), Fideliza+ (#9), reorganização visual (#13) incremental.

## Regras de arquitetura
- Preservar fluxos v0.10 e o checkpoint v0.11.
- Separar áreas de Pedidos, Impressão, Entregas, Clientes, Estoque, Financeiro, Relatórios, Fideliza+, Alertas, Configurações.
- Isolamento multi-tenant e RLS; validação de autorização no backend; auditoria de operações sensíveis.
- Marketplaces e pagamentos online: somente ativar funções confirmadas e homologadas.
- Pix manual: pendente de conferência, nunca pago automaticamente.
- Impressão: spooler não é prova de papel impresso.
- Entregas: limite de agrupamento configurado pela loja; alocação automática verifica direção e desvios; manual pode ignorar contramão com aviso.

## Validação por entrega
- Testes unitários, integração e regressão de checkout, pedidos e impressão.
- Teste físico 80 mm no Windows e teste de reconexão/falha de impressora.
- Testes de isolamento de lojas, permissões, concorrência e duplicação.
- Registrar evidências e versão; só fechar issues após critérios de aceite cumpridos.

## Observação sobre impressão
A reconstrução já aplica `add_printer_ui_013.py`, `printer_experience_031.py` e `print_device_controls_033.py`. Conferir estados de edição e controles duplicados após restauração, antes de modificar o fluxo. Tarefa de auditoria: #14.

## Próxima ação técnica
Extrair fontes do ZIP conforme pipeline existente, identificar módulo de impressão e executar reprodução do erro. Este arquivo é planejamento, não implementação funcional.
