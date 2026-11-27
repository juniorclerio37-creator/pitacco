# Estado da entrega e testes — 07/11/2026

## Resultado desta etapa

Código integrado de desenvolvimento, com fluxo operacional próprio no backend: gestor registra pedido → aceite manual/automático → tarefas de impressão e entrega são criadas na mesma transação → aplicativo Windows recebe/persiste tarefas → spooler → entrega pode ser atribuída pelas funções existentes e lida pelo Flutter.

Esse fluxo foi validado por partes em testes automatizados. **Não houve teste completo em Windows, impressora física, Supabase hospedado e Android juntos. Não está pronto para comercialização.** Não foi criado instalador fictício nem APK.

## Verificação de preservação

Comparação binária com os ZIPs recebidos: nenhum arquivo original ausente. Web: 16 arquivos originais, 14 iguais; `src.jsx` e `package.json` atualizados. Android: os 7 arquivos originais iguais. Arquivos novos adicionados e originais ZIP preservados byte a byte em `originais/`. Veja `evidencias/verificacao-preservacao.json`. O manifesto SHA-256 permite verificar a integridade do checkpoint.

## Testes executados

| Área | Resultado | Limite |
|---|---|---|
| React/Vite | Build de produção passou, 1627 módulos | URL/chave públicas fictícias usadas para validação; não houve deploy |
| JavaScript | 15 testes passaram | Recibos, ordem enqueue/ACK, duplicações e regras de rotas; não valida hardware |
| PostgreSQL PGlite | Migrações schema e 003–010 aplicadas; assertions SQL passaram | Auth/Storage de teste; sem Supabase hospedado, WebSocket real ou concorrência entre conexões |
| Rust fila/formatador | Núcleo compilado e testes executados; ver log `testes-rust.txt` | Núcleo real SQLite/ESC-POS no Linux; não compila nem executa o shell Tauri/Win32 |
| Instalador Windows | Tentativa de build cruzado falhou | Ferramenta `x86_64-w64-mingw32-dlltool` ausente; instalação de ferramentas de sistema falhou por permissões |
| Navegador automatizado | Não concluído | Playwright sem navegador; download retornou arquivo inválido/truncado |
| Impressão e notificações nativas | Código e roteiro de testes entregues | Não executados em Windows; sem impressora física |
| Flutter/APK | Fontes originais preservadas | Flutter/SDK Android indisponíveis; nenhum APK compilado |

O bundle React emite aviso de chunk acima de 500 kB; não é falha de build. Os logs executados estão em `evidencias/`. A transcrição resumida da tentativa Windows está identificada como resumo, não como log integral.

O teste SQL cobre criação idempotente, aceite repetido, impressão apenas após aceite, recibo sem campos secretos, reimpressão idempotente com auditoria, RLS/lojas, proteção contra inserção direta de pedido aceito, segundo dispositivo bloqueado, estados incertos preservados, marketplace recusado e despacho automático. O teste de transação não equivale a teste de hardware nem certificação de APIs.

## Implementado no código

- Mesma autenticação Supabase e seleção de loja; painel React compartilhado web/Tauri.
- Configuração de aceite por restaurante/origem. Automático efetivo somente em pedidos próprios criados pela RPC operacional.
- Aceite próprio transacional, outbox por setor/via, UUID estável e entrega vinculada.
- Impressoras por setor com snapshot de fila Windows, 58/80 mm e vias.
- SQLite WAL/FULL, deduplicação, retry conservador pré-envio e estado incerto após interrupção.
- Envio RAW ESC/POS pelo spooler Windows; USB/rede/Bluetooth por driver compatível.
- Bandeja, ocultar no X, autostart configurável, notificação/som e botão de atualização assinada quando configurada.
- Realtime com consulta periódica de recuperação, fila local visível mesmo sem servidor.
- Reimpressão com motivo/usuário/horário no servidor. Um computador vinculado por loja.

## Pendências para um pedido completo de cliente real

| Etapa | O que falta |
|---|---|
| Cliente faz pedido | Cardápio público, carrinho e checkout não estão implementados nesta etapa; o formulário entregue é operacional e autenticado |
| Pagamento | O formulário registra dinheiro/Pix/cartão, mas NÃO cobra nem confirma pagamento. Implementar checkout, gateway oficial, webhook, conciliação e idempotência; não tratar Pix selecionado como pago |
| Marketplace chega | Credenciais, homologação, webhooks verificados e conectores oficiais iFood/99Food/Keeta ainda faltam |
| Aceite de marketplace | Bloqueado por código, sem simulação de confirmação; faltam adapters oficiais e reconciliação de resposta/timeout |
| Políticas avançadas | Horários, estoque, recusa e elegibilidade comercial ainda faltam |
| Impressão real | Compilar/instalar em Windows, validar drivers 58/80, notificações, bandeja, offline, retomada e reimpressão |
| Entregador recebe | Vincular usuários/entregadores no mesmo Supabase, gerar Android nativo conforme README Flutter e configurar Firebase/notificações |
| Entrega é concluída | Validar atribuição, retirada e conclusão em APK real; código de marketplace permanece dependente de API oficial |
| Produção | Testes de concorrência, autorização real, retenção/backup, migração de dispositivo, assinatura/distribuição, pagamento e observabilidade |

As funções existentes de entregas foram preservadas e a 010 liga o pedido aceito à entrega. O roteiro de ponta a ponta não deve ser considerado aprovado apenas por essa ligação existir. O app Android original não inclui pastas de plataforma geradas; seguir seu README para `flutter create`/configuração antes de build.

## Como reproduzir

Na pasta `web`:

```text
npm ci
npm test
npm ci --prefix tests/backend
npm test --prefix tests/backend
cargo test --locked --manifest-path native-tests/Cargo.toml
npm run build
```

Configure `.env` antes do build React/Tauri. Para instalador, siga `WINDOWS.md`. Os testes backend usam PGlite e dados fictícios, sem conexão com produção. Testes SQL com psql devem ser usados somente em banco de homologação. Nenhuma operação foi executada em conta real de restaurante/marketplace.
