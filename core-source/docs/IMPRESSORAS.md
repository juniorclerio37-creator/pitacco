# Configuração e homologação de impressão

O backend salva uma tarefa por pedido + setor + via + solicitação. O aplicativo grava a tarefa em SQLite antes do ACK e usa o mesmo ID em reentregas. Não deve haver serviço de impressão paralelo imprimindo os mesmos pedidos.

## Compatibilidade prevista, ainda sem teste físico

| Conexão | Como configurar |
|---|---|
| USB | Instalar o driver e uma fila de impressão do Windows |
| Rede | Adicionar impressora TCP/IP pelo Windows e instalar o driver |
| Bluetooth | Parear e instalar driver/fila que aceite RAW; equipamentos BLE sem fila Windows não são suportados |
| Papel | 58 mm usa 32 colunas; 80 mm usa 48 colunas |

O modelo precisa aceitar ESC/POS RAW. Impressoras GDI, PDF e modelos com protocolo proprietário não são equivalentes. A saída usa ASCII com remoção de acentos para evitar divergências de code page; não há logotipo. Corte ESC/POS é emitido e precisa ser validado no modelo. A lista de impressoras contém filas instaladas no Windows, não descoberta direta de dispositivos.

Configure setores, vias (1 a 5), nome exato da fila e largura ANTES de aceitar o primeiro pedido. Sem setor ativo o pedido pode ser aceito, mas não gera comanda; após configurar, peça reimpressão auditada. Alterar uma configuração não altera o snapshot de tarefas já criadas. O teste é um pedido fictício de retirada pelo formulário operacional, evitando gerar entrega real.

## Estados e recuperação

- queued: persistido, aguardando envio.
- printing: execução iniciada, não reenviar por conta própria.
- submitted: Windows aceitou o documento; **não prova saída de papel**.
- error: falha detectada antes da criação do documento no spooler; até cinco tentativas com espera crescente, depois intervenção manual.
- uncertain: falha/interrupção depois de iniciar envio ou reinício com tarefa printing. Sem repetição automática.

A fila fica no diretório de dados locais do aplicativo (`app_local_data_dir`, identificador com.deliverygestor.desktop), arquivo `print-queue.sqlite3`, com WAL e synchronous FULL. Não apague esse arquivo para tentar corrigir impressão: ele contém deduplicação e tarefas. Não copie o banco para outro computador ativo; isso clonaria a identidade do dispositivo.

Para uncertain, verifique papel e spooler. Se necessário, cancele o trabalho antigo no Windows antes de pedir reimpressão, evitando que duas cópias saiam depois. No painel, informe motivo de pelo menos cinco caracteres. O servidor registra usuário, horário e pedido e cria novos IDs. Falhas do driver detectáveis ANTES do envio aparecem no aplicativo. Falhas físicas depois de submitted podem aparecer apenas no Windows/impressora: não há monitoramento de confirmação física nesta versão.

## Roteiro obrigatório em Windows (ainda não executado)

1. Testar uma via de retirada em 58 mm e 80 mm, conferir itens, complementos, valor, pagamento, endereço e quebra de linhas.
2. Repetir evento/recepção do mesmo ID: apenas uma comanda automática.
3. Configurar cozinha e expedição e duas vias; conferir quantidade de cópias.
4. Desconectar impressora antes do envio, observar error e reconectar.
5. Encerrar processo durante envio, abrir e conferir uncertain sem reenvio automático.
6. Cortar internet depois da gravação local; conferir processamento da fila salva e sincronização posterior.
7. Testar notificação/som, fechar pelo X, receber pedido na bandeja e reiniciar Windows com autostart.
8. Pedir reimpressão com motivo e verificar operation_audit.
9. Usar segunda conta/loja e segundo computador: verificar isolamento e bloqueio de vínculo concorrente.

Não prometer impressão física exatamente uma vez: Windows/ESC-POS não fornece confirmação transacional de papel por tarefa. As decisões conservadoras acima evitam reenvio cego em resultado ambíguo.
