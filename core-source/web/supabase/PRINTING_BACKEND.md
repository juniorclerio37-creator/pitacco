# Backend de aceite e impressão — implementação e limites

## Instalação

Em um projeto Supabase de homologação, aplicar **nesta ordem**:

1. `schema.sql`
2. `003_delivery.sql`
3. `004_dispatch_mobile.sql` (origem: projeto Flutter)
4. `005_routes_and_delivery_codes.sql` (origem: projeto Flutter)
5. `006_dispatch_batches.sql`
6. `007_marketplace_logistics.sql`
7. `008_imports_external_delivery.sql`
8. `009_menu_images_dispatch_policy.sql`
9. `010_acceptance_printing.sql`

A migração 010 é transacional e de execução única. Antes de aplicá-la em dados existentes, conferir duplicidades em `deliveries.order_id`; não apagar dados para satisfazer o índice sem conciliação. Configurar usuários, perfis e vínculos `store_members` como nas instruções originais. Operações de aceite/impressão exigem papel `gestor` na loja ou administrador. Usar somente chave anon/publicável no aplicativo.

## Fluxo implementado

`create_operational_order` permite ao gestor registrar um pedido próprio, com soma validada dos itens. Não é checkout público. A opção automática da origem `proprio` chama o mesmo aceite transacional no servidor; no modo manual o cliente chama `accept_order`. O aceite bloqueia a linha, muda status uma única vez, salva snapshot de comanda, cria uma tarefa por setor/via e uma entrega vinculada quando logística=`loja`. Retirada não cria entrega. Os registros financeiros antigos ficam `historical` e não imprimem.

São preservadas as tabelas de entregas usadas pelo APK; a confirmação do aceite do restaurante não equivale ao aceite pelo entregador. Realtime é habilitado para orders, print_jobs e deliveries quando existe a publicação Supabase.

Sem setores habilitados, o aceite continua funcionando, mas não cria impressões. Configure impressoras antes de iniciar o expediente. Após configurar, peça uma reimpressão auditada para pedidos já aceitos. Esta versão envia a comanda inteira a cada setor, sem filtragem de produtos por setor.

## Contratos

- `acceptance_settings`: store_id, source (`proprio`, `ifood`, `99food`, `keeta`), mode (`manual`, `automatic`), enabled. Configuração por origem; somente próprio é executado nesta versão.
- `print_sectors`: store_id, sector, printer (nome instalado no Windows), width (58 ou 80), copies (1 a 5), enabled.
- `bind_print_device(p_store,p_device)`: primeiro vínculo, repetível somente com o mesmo UUID.
- `claim_print_jobs(p_store,p_device)`: máximo 100 tarefas pendentes atribuídas por chamada; retorna até 100 ainda não submetidas, com ID estável e printer/width/receipt_text imutáveis.
- `ack_print_job(p_job,p_device,p_state,p_error)`: saved, submitted, uncertain ou error. Repetição idêntica não gera nova auditoria. saved não reabre uncertain/error. submitted é terminal e significa **enviado ao spooler**, não papel impresso.
- `reprint_order(p_order,p_request,p_reason)`: motivo mínimo 5 caracteres; novo UUID por intenção de reimpressão; retries usam o mesmo UUID. Cria tarefas novas e auditoria. Não reabre as tarefas antigas.

## Resiliência e limites

Uma loja tem um computador de impressão fixo. Não há reassociação automática após timeout: isso evita que um segundo computador imprima um trabalho já recebido pelo primeiro enquanto ele está offline. Troca ou perda de computador exige parar o agente antigo, conciliar filas locais/spooler e redefinir o vínculo administrativamente. A migração não fornece RPC de tomada forçada de posse.

A fila local deve persistir antes do ACK saved e deduplicar pelo ID de tarefa. A função claim retorna saved/error/uncertain novamente: recebimento repetido não autoriza novo envio físico. O aplicativo não deve alterar tarefas uncertain para queued automaticamente. Após uma interrupção que deixe o resultado ambíguo, o restaurante deve conferir o papel/spooler e pedir uma reimpressão consciente.

Não se promete entrega exatamente uma vez na impressora: a maioria dos drivers ESC/POS não confirma fisicamente cada comanda. submitted registra apenas aceitação pelo spooler. A confirmação física e falhas de hardware dependem do driver/dispositivo.

Pedidos e comandas têm dados pessoais. Definir política de retenção, backup e controle do usuário Windows antes de produção. Não foi implementada eliminação automática de snapshots/auditoria nesta etapa.

## Marketplaces

`accept_order` rejeita qualquer origem diferente de `proprio`, inclusive se existir configuração automática. Não existe uma RPC cliente que declare sucesso de marketplace. Os conectores oficiais, credenciais, webhook autenticado, horários de funcionamento, verificação de estoque, recusas e integração de pagamento ainda precisam ser implementados/homologados. Não usar insert SQL com status accepted como substituto de confirmação oficial.

A comanda usa campos permitidos; um campo estruturado delivery_code ou qualquer campo extra não entra no snapshot. Textos livres são sanitizados contra comandos de controle, mas funcionários não devem digitar segredos em observações.

## Testes

O arquivo `tests/010_acceptance_printing.test.sql` contém fixtures transacionais para manual/automático, duplicação de aceite, duplicação de criação e reimpressão, isolamento entre lojas, bloqueio de segundo computador, proteção de uncertain, impressão somente após aceite, vínculo à entrega e bloqueio de marketplace. Executar com `psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/tests/010_acceptance_printing.test.sql` apenas em uma instância de homologação depois das migrações.

**Estado nesta entrega:** todas as migrações e as asserções SQL passaram em PostgreSQL WASM (PGlite 0.5.15), incluindo despacho automático para entregador disponível. O harness em `tests/backend` cria stubs de Auth/Storage, papéis anon/authenticated e publicação Realtime; remove somente `create extension pgcrypto` do schema no teste, usando `gen_random_uuid` nativo. Reproduzir: `cd tests/backend && npm ci && npm test`. O projeto Flutter deve permanecer na disposição de diretórios do pacote; caso movido, definir `DG_ANDROID_SUPABASE` com caminho absoluto terminado em `/` para suas migrações.

Isso valida SQL/PLpgSQL, transações sequenciais e RLS em um motor PostgreSQL local. **Não valida** integração Supabase hospedada, autenticação HTTP, entrega Realtime/WebSocket, concorrência entre duas sessões, push, impressão física ou queda durante COMMIT. Esses testes ainda exigem homologação real.

A migração também corrige a incompatibilidade anterior de `dispatch_mode` entre `automatica` (004) e `automatico`/`misto` (009). A atribuição na inserção seleciona um entregador disponível sem outras entregas ativas; não agrupa automaticamente pedidos nem usa trânsito.
