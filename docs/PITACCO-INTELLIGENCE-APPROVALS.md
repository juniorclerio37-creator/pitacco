# Pitacco Intelligence — Central de Correções (v3)

## Escopo implementado

O modelo de IA **não** executa SQL arbitrário, atualiza código, reenvia pedidos ou muda integrações. A tela do proprietário inclui um catálogo com **uma única correção executável e reversível**:

- `enable_store_order_sound`: **reativar aviso sonoro de novos pedidos no painel de uma loja** apenas se a configuração já estiver salva e desativada.
- Não altera o volume; não altera o app Windows nem a notificação no Android. Não é uma correção automática para Firebase, iFood, 99Food, Keeta ou impressão física.

Outros alertas (impressão, push dos entregadores, marketplaces) continuam oferecendo **diagnóstico e verificação**, não botões de reparo.

## Processo e limites

1. O Super Admin escolhe a loja e cria uma proposta. **Nada operacional é alterado** nessa etapa.
2. O Super Admin revisa e clica **Aprovar e aplicar** com confirmação explícita. O banco compara os valores atuais aos observados ao criar a proposta; se houve alteração, bloqueia e solicita uma nova avaliação.
3. O executor altera exclusivamente `pitacco_store_sound_settings.enabled` para `true` e preserva `volume`.
4. O mesmo proprietário pode clicar **Reverter alteração**. O banco só restaura `enabled=false` quando a configuração continua exatamente como foi deixada na aplicação; caso o lojista tenha modificado a configuração depois, o rollback falha de modo seguro.
5. **Rejeitar** descarta propostas não aplicadas, sem alterar configuração.

As tabelas `pitacco_private.intelligence_repair_proposals` e `pitacco_private.intelligence_repair_audit` guardam as decisões, responsáveis e datas. Os RPCs públicos verificam `pitacco_is_platform_owner()` no servidor; não expõem acesso direto às tabelas. Há exclusividade de proposta pendente/aplicada por loja e tipo. Não existem automatismos ou cron para criar ou aplicar correções.

## RPCs

- `pitacco_owner_repairs(p_store uuid default null)`: consulta histórico (até 30 propostas) e elegibilidade, somente proprietário.
- `pitacco_owner_repair_propose(p_store uuid)`: propõe mudança para loja cujo som já está configurado e desativado.
- `pitacco_owner_repair_decide(p_proposal uuid,p_action text)`: ações estritamente permitidas `apply`, `revert` e `reject`.

## Testes e implantação

O teste `revisions/0.12/web/tests/backend/incident-monitor.test.sql` verifica negação a gestores, aprovação com mudança efetiva, registros de auditoria, rollback e proteção contra configuração desatualizada.

Implantar a migração `supabase/migrations/20261118043000_pitacco_owner_repair_approvals.sql` **antes** do novo Admin. O site deve preservar login, monitoramento, Pedidos, iFood e impressão. O GitHub Actions `admin-deploy.yml` requer `PITACCO_ADMIN_CLOUDFLARE_API_TOKEN` e `PITACCO_ADMIN_CLOUDFLARE_ACCOUNT_ID`, caso contrário ele pula a publicação; compilação aprovada não significa implantação.

**Definição de reversão:** restaura somente a configuração `enabled` quando não houve mudança posterior. Não desfaz eventos históricos nem reverte impressões, pagamentos ou entrega; esses últimos não têm executor nesta versão.
