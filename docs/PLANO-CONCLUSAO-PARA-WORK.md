# Pitacco — plano executável de conclusão antes da impressão
Data: 2026-11-11

## Decisão do produto
Priorizar completar funcionalidades de negócio e integrações. **Impressão Windows é a última fase**, sem remover a fila atual. Windows = Pedidos, Cozinha/Expedição e Configurações de impressão; web = gestão completa. Tema laranja e marca da sacola preservados. Não reativar `rebuild_workspaces_043.py` sem resolver a tela branca documentada no restore.

## Estado comprovável do repositório
- `source/*.b64` contém fonte preservada, reconstruída por `python revisions/0.12/restore.py`; `updates/0.11.1` e `revisions/0.12` são aplicados em ordem. Não editar somente arquivos gerados em `web/`: alterações permanentes devem entrar em overlays versionados.
- `ENTREGA-0.12.md` registra build de teste anterior, mas não valida impressão física, GPS em aparelho ou integrações oficiais.
- `revisions/0.12/docs/ATUALIZACAO-0.12.md` registra checkout visual público incompleto, conciliação/CRM/relatórios limitados, worker de rotas condicionado a configuração e marketplaces sem homologação.
- As verificações existentes no workflow Windows contêm expectativas de navegação antigas; revisar antes de confiar em CI verde. Nenhuma funcionalidade abaixo está declarada concluída por este documento.

## Ordem de execução — cada fase exige código, migração, testes e evidência
### P0 — Estabilidade, autenticação e isolamento
1. Reconstruir fonte em checkout limpo e executar testes atuais antes de modificar.
2. Corrigir tela branca/navegação sem reintroduzir módulos administrativos no Windows.
3. Login email/senha, confirmação de email, recuperação de senha, seleção de loja, sessão e RLS; impedir acesso entre estabelecimentos. Não expor service_role no cliente.
4. Criar smoke tests de fluxo por loja, erros de rede, refresh, sessão expirada, navegação mobile e desktop.

### P1 — Pedidos e checkout próprio
1. Cardápio público completo: loja/logo, horários, disponibilidade, categorias, produtos, imagens, variações, complementos, carrinho, taxas por área e agendamento.
2. Checkout: dinheiro e cartão na entrega; Pix manual sempre pendente até conferência; online só confirmado por webhook assinado/idempotente do provedor.
3. Persistir pedido de forma atômica e idempotente; receber/aceitar/recusar, preparo, pronto, despacho, entrega, cancelamento, histórico e notificações.
4. Bloquear duplicidade por origem+ID externo e por chave idempotente no checkout; preservar número legível sem reutilizar ID técnico.
5. Testes: pedido repetido simultaneamente, taxa, cupom, complemento, indisponibilidade, agendamento e pagamento não confirmado.

### P2 — Entregadores, rotas e financeiro do entregador
1. Cadastro, permissões, online/offline, disponibilidade, GPS com consentimento, agrupamento e fechamento de rota após saída.
2. Automático: respeitar máximo configurável pela loja, direção real, sentidos viários, capacidade, desvio e prazo; nunca agrupar contramão automaticamente.
3. Manual: permitir desvio/contramão com alerta e auditoria; verificar política específica para alterações após saída.
4. Remuneração por km, diária, taxa fixa ou mista, histórico imutável, acerto de dinheiro, Pix pendente e fechamento; impedir dupla liquidação.
5. Rastreio por pedido somente quando saiu para entrega; prova própria foto/PIN; PIN marketplace apenas conforme regra oficial.

### P3 — Gestão web
1. Financeiro: caixa, despesas, taxas, repasses e conciliação por marketplace; diferença explícita entre bruto, descontos, frete, taxas e líquido.
2. Clientes: cadastro, histórico, bloqueio com motivo e auditoria, respeitando direitos de acesso; Fideliza+ com saldo e regras transacionais.
3. Estoque: fichas técnicas, unidade/conversão, baixa no evento correto, estorno por cancelamento e alertas de mínimo.
4. Funcionários: RBAC por loja, auditoria de ações sensíveis.
5. Relatórios: vendas, cancelamentos, entregas, produtividade, margem e exportação CSV/PDF com filtros por loja/período.
6. Painel proprietário: assinaturas R$ 59,90/loja/mês, 7 dias grátis uma vez por estabelecimento, bloqueio apenas de novas operações após vencimento, preservação de pedidos em curso e reativação somente após confirmação confiável.

### P4 — Integrações externas (não simular homologação)
1. Adaptadores separados para iFood, 99Food e Keeta; até 3 contas de cada por loja, quando oficialmente permitido; mapear estados e IDs, webhooks autenticados e reprocessamento.
2. Pagamentos: arquitetura de provedores PagBank, Mercado Pago, Stone, Asaas, Efí; conectar apenas APIs e credenciais válidas, webhook assinado, conciliação e reembolso.
3. Entregas parceiras: Uber Direct, 99 Entregas e iFood quando contratos/APIs autorizarem; sem preço, despacho ou status fictício.
4. WhatsApp: templates aprovados e consentimento, filas de envio, retries e opt-out; evitar alegar envio sem confirmação do provedor.
5. Documentar para Work exatamente quais credenciais/contratos estão faltando, sem copiá-las para logs, GitHub ou frontend.

### P5 — Preparação para produção
1. Testes E2E de checkout→pedido→aceite→entrega, multi-tenant, concorrência, regressão e cenários de falha.
2. Migrações incrementais com backup, reversão documentada e compatibilidade; nunca reinstalar schema inicial sobre banco existente.
3. Deploy Cloudflare, Supabase e worker com health checks, monitoramento, logs sem dados sensíveis, domínio, HTTPS e verificação de build.
4. APK e instalador de teste; assinatura de produção e atualização automática somente com chaves/certificados configurados.

### P6 — Impressão Windows (ÚLTIMA)
Retomar diagnóstico de spooler 80 mm, vinculação, editar/excluir, HTML real, fila SQLite e reimpressão com auditoria. Testar impressora física e diferenciar spooler de papel impresso. Ver `docs/REGRESSAO-IMPRESSAO-WINDOWS.md` na PR específica de impressão; não bloquear P0–P5 por esta etapa.

## Instruções de execução para ChatGPT Work
- Criar branch por fase, PRs pequenos, testes e checklist de aceite. Não fazer push direto na main sem validação.
- Manter código em overlays compatíveis com `restore.py`; não substituir o ZIP base nem descartar versões anteriores.
- Usar componentes reais e dados do Supabase, nunca botões decorativos, mocks apresentados como produção ou aprovações fictícias.
- A cada fase informar: arquivos alterados, migrações, testes que passaram/falharam, link da PR, pendências externas e demonstração funcional.
- Aguardar credenciais oficiais para homologar integrações; não inventar resultado.
- Não declarar 'pronto' por existir interface: somente após teste verificável do fluxo.
