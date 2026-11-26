# Pitacco Windows — critérios de correção da impressão

## Escopo obrigatório
Somente o aplicativo Windows gerencia impressoras, vínculo do computador, testes físicos, fila local e reimpressão. O painel web não deve exibir controles nativos de impressora.

## Falhas a reproduzir
1. Impressora 80 mm aparece no Windows e imprime pelo sistema operacional, mas falha no Pitacco.
2. Impressora cadastrada não permite editar, configurar ou excluir.
3. Reimpressão de pedido existente não produz nova tentativa confiável.
4. Falha no spooler não deve interromper sincronização dos pedidos.

## Verificações de código antes de alterar
- `web/src-tauri/src/printer.rs`: `GetPrinterW` com buffer variável, erro 122 e `EnumPrintersW`; verificar retorno real de `StartDocPrinterW`/`WritePrinter`/`EndDocPrinter`.
- `web/src-tauri/src/main.rs`: comando `test_printer`, validação do nome e largura 58/80, propagação de erros.
- `web/Operations.jsx`: salvar/editar/excluir setores, vínculo único, fila e ações de reimpressão apenas no desktop.
- `web/printBridge.mjs`: o HTML personalizado deve ser aplicado à comanda real, não somente à prévia.
- `web/src.jsx`: manter Windows limitado a Pedidos, Cozinha/Expedição e Configurações; administração continua no site.

## Critérios de aceite
- Impressora listada e selecionada por nome exato do Windows; configuração persistente após reiniciar.
- Vincular e transferir computador com confirmação e isolamento por loja.
- Editar largura, cópias e setor; excluir apenas sem trabalhos pendentes/incertos.
- Imprimir teste 80 mm e 58 mm com retorno do ID do trabalho no spooler; nunca confundir spooler com papel efetivamente impresso.
- Pedido aceito entra uma única vez na fila SQLite e pode ser reimpresso sob comando explícito, com novo registro de tentativa e auditoria.
- Falha, impressora offline e reinício não perdem o trabalho nem duplicam impressão automaticamente em estado incerto.
- HTML personalizado não executa scripts e deve refletir no texto efetivamente enviado.
- Testar em Windows real com impressora 80 mm; testes automatizados isolados não substituem teste físico.

## Situação
Checklist de regressão preparado. **Nenhuma correção executável ou teste físico está atestado por este arquivo.** Não liberar como versão corrigida até passar pelos critérios acima.
