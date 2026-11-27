# Pitacco Control Center

A central administrativa usa o Supabase existente e o Worker `pitacco-admin`. Não há outra base de estabelecimentos.

## Operação e definições

- Dashboard por período: vendas concluídas das lojas, recebimentos registrados do Pitacco, contratos mensais ativos (MRR), ritmo anualizado (ARR), cobranças abertas, custos registrados, origem dos pedidos e alertas.
- Vendas históricas, canceladas e explicitamente marcadas como teste não entram no faturamento concluído. O faturamento das lojas nunca é somado à receita do Pitacco.
- Custos sem lançamentos são desconhecidos, não zero. Ocorrências Asaas pendentes de conciliação têm aviso próprio; os recebimentos não substituem um balanço de estornos.
- Projeção de recebimentos usa somente faturas abertas por vencimento. ARR é MRR × 12, não garantia de receita.
- Conversão e churn usam coortes observadas desde a implantação. Sem coorte no início do período, a taxa fica indisponível. Suspensão e atraso não são tratados como cancelamento comercial.
- Lojas abertas são cardápios habilitados e abertos pelo horário efetivo. Conexão Windows e GPS de entregadores são sinais separados.

## Segurança

O proprietário conserva a identificação existente. A equipe administrativa entra com contas individuais já cadastradas. Os perfis observador, suporte, financeiro e operações têm módulos limitados; revogações são verificadas no banco a cada chamada.

Ative o autenticador em **Segurança e auditoria**. O titular lê o QR Code em seu próprio aplicativo e confirma o código. Operações críticas, inclusive APIs administrativas anteriores protegidas na migração, exigem AAL2 no servidor. A ferramenta não cria fatores para o titular.

Sessões administrativas revogadas deixam de acessar as APIs protegidas, mesmo com um JWT ainda não expirado. Os dados privados não recebem acesso direto de `anon` ou `authenticated`.

A assistência exige solicitação identificada, aprovação de um gestor realmente vinculado à loja, prazo de 30 minutos e auditoria. O solicitante não pode aprovar a própria solicitação. A visão reutiliza o componente de Visão Geral do lojista e uma lista de pedidos, somente leitura, com dados pessoais de clientes omitidos. Consentimento e validade são verificados novamente no servidor; a tela consulta a cada 15 segundos e se encerra no vencimento.

## Versões e compatibilidade

O catálogo oficial consulta apenas as publicações do repositório Pitacco. Uma versão Windows sem manifesto legível permanece sem versão semântica informada; ela não é deduzida do hash do commit.

Versões mínimas são opcionais e não são ativadas na migração. A alteração exige segundo fator, justificativa e confirmação. No Windows, a política protege novas vendas de sessões identificadas pelo heartbeat nativo; no Android, protege novas atribuições e entrada online. Trabalhos em andamento não são bloqueados. Remover a exigência é auditado.

A telemetria de versão é informada pelo aplicativo autenticado, sem afirmar validação do binário. Windows usa o identificador do computador e a versão do pacote. Android usa a versão recebida da ponte nativa existente e a sessão autenticada. Apps antigos sem esse sinal aparecem sem versão conhecida.

Uma reversão binária exige um pacote assinado e compatível; o painel não executa downgrade automático. Os fluxos existentes de publicação, retirada e verificação de integridade continuam disponíveis.

## Evidências e limites operacionais

O teste técnico ao vivo verifica a rota do Worker e uma consulta autenticada ao Supabase. Outros serviços permanecem sem evidência recente até receberem uma observação confiável. Observações têm vencimento e não tornam um serviço permanentemente operacional.

Um sinal de impressão não comprova papel impresso. Envio de push não comprova recebimento ou som em segundo plano. Credenciais configuradas não comprovam homologação.

Despesas e custos são lançamentos administrativos; faturamento automático dos provedores, disponibilidade externa contínua e testes em dispositivos físicos precisam de suas fontes e evidências próprias. Backups e restauração seguem os recursos do provedor; uma restauração de produção não é executada como teste.

## Validação e publicação

A publicação do Admin depende dos testes JavaScript, migrações e permissões em PostgreSQL 17, testes de concorrência e navegação em Chromium (375, 768 e 1440 pixels). As fixtures são exclusivas dos testes e não são empacotadas no Admin de produção.
