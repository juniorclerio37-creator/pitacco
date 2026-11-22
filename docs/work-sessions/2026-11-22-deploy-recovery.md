# Sessão 1 — recuperação de publicação (22/11/2026)

## Resultado verificado
Deploy automático do site/painel recuperado pelo commit a0a4e1962ddfe37b6746fe69dd79206681cb220e.
Run: https://github.com/juniorclerio37-creator/pitacco/actions/runs/45024151144
Preflight, build, isolamento do bundle lojista, deploy e verificação HTTP passaram.
Worker existente: pitacco. Versão ativa a 100%: 9e0b7c73-4b47-4ec7-a831-cfa7999f4099.
Publicação confirmada pela API Cloudflare em 22/11/2026 09:48:46 (Brasília).
Nenhum Worker, domínio, banco, integração ou token foi criado ou substituído.

## Causa e mecanismo anterior
O workflow site-deploy.yml foi introduzido em a33e56b (19/11).
O run 45022749849 executava preflight com PITACCO_SITE_TOKEN vazio e pulava publish.
Logo, a conclusão success desse workflow não comprovava publicação.
Os nomes PITACCO_SITE_CLOUDFLARE_API_TOKEN e CLOUDFLARE_API_TOKEN estavam indisponíveis no contexto desse job; não foi possível distinguir inexistência de restrição de escopo via listagem administrativa, que a conexão GitHub não oferece.
O Admin usa segredo PITACCO_ADMIN_CLOUDFLARE_API_TOKEN e variável (não segredo) PITACCO_ADMIN_CLOUDFLARE_ACCOUNT_ID.
Run 44920789733 do Admin publicou realmente em 21/11, versão b3313593-fad5-462e-ac9f-6f4634b554cc.
A Cloudflare também registrava publicações Wrangler externas ao workflow do site: pitacco às 09:32:58 e pitacco-admin às 09:33:48 de 22/11. Os metadados não identificam a máquina nem o SHA dessas execuções; não atribuir sua origem além de Wrangler.
Não existe workflow de deploy do site anterior a a33e56b no histórico desse caminho.

## Correção mínima
Mantida a preferência pelo token dedicado do site e pelo token genérico.
Adicionado fallback para o segredo já utilizado pelo Admin, condicionado à variável de conta do Admin coincidir com a conta existente do Pitacco.
O deploy bem-sucedido confirmou que essa credencial tem permissão para atualizar o Worker pitacco.
Nenhum valor secreto foi lido, exposto ou alterado.
Permissões declaradas de GITHUB_TOKEN permanecem contents: read; autenticação Cloudflare é separada.
Não foram necessárias mudanças nas permissões administrativas de GitHub Actions.
Site institucional, cardápios e app.pitacco.com.br usam pitacco/ASSETS; admin.pitacco.com.br usa pitacco-admin separado.
O Admin não foi republicado nesta sessão.

## Preservação e validação
Os quatro commits solicitados são ancestrais da main:
- 54d42e565dfff8cc1d5bac37238a54478ba3a316: cabeçalho/cards.
- 86e25e620dec6bed605205cde34c161597edf379: modal compacto.
- 5a3b5cdf1548eb4f5f4d900c308349ee6775f7e3: fixture.
- 49fdc8d4731aeb3d79448162c958296d618b0dd5: assinatura pg_cron.

Verificação HTTP após recuperação: pitacco.com.br/, app.pitacco.com.br/app/ e admin.pitacco.com.br/ responderam 200.
CSS público index-ee8I9_nc.css contém as regras .app>aside .brand img, .kanban .order-card e .delivery-dialog.dispatch-only.
JS público index-DU4VmRGO.js e CSS público têm os mesmos nomes de hash observados antes da recuperação: não houve alteração do produto nesta sessão.
Não foi feita inspeção visual em navegador nem validação autenticada em produção.
Testes locais do preflight: token ausente, token dedicado, fallback na conta correta e fallback com conta divergente: 4/4 passaram; git diff --check passou.
Build de produção e proteção contra código administrativo no bundle passaram no novo run.

## Estado dos testes herdados
Nos commits 54d42e5, 86e25e6 e 5a3b5cd, os runs Windows e Validar site e cardápio falharam; os runs Site terminavam success com publicação pulada.
Em 49fdc8d:
- Windows 45022749881: build, testes JavaScript/SQL/fila nativa, PostgreSQL/concorrência e publicação de instalador passaram (execução anterior à sessão; não gerado novamente).
- Site 45022749849: publicação pulada por token vazio.
- Validação 45022749753: PostgreSQL, build, regras e checkout público passaram; etapa Chromium falhou.
Falha exata: tests/dashboard.browser.mjs:704 aguardando botão "Salvar e ativar área de entrega" por 30s. Logs também têm DNS de WebSocket de fixture; não foi comprovado nexo causal.
Fluxos do dashboard em 375px e 768px passaram naquele log antes da falha no cenário 1440px.
Não declarar toda a suíte verde.

## Continuidade autorizada somente após nova aprovação do usuário
Sessão 1 encerrada. Próxima sessão: começar pela falha de tests/dashboard.browser.mjs:704, comparar seletor com interface/fixture existentes, reproduzir somente esse caso e corrigir o defeito comprovado. Depois seguir prioridades da Sessão 2.
Android, Windows, regras comerciais, dados financeiros e configurações de lojas não foram alterados.
Não gerar APK/instalador nem executar auditoria geral ao retomar.
Consumo real de créditos indisponível; esforço concentrado em uma correção de workflow e um build de produção no GitHub, reutilizando logs existentes.
