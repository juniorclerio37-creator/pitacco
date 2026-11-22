# Pitacco — aprimoramento geral, 22/11/2026

Execução parcial, com correções publicadas. Este relatório não homologa integralmente as sete prioridades.
Nenhum pedido real foi criado para teste; não houve cobrança, exclusão de dados ou alteração de planos, taxas e comissões.

## 1. Pedidos e integrações — correções verificadas; homologação real pendente

1. **Verificado:** fluxo do entregador, coleta/saída/chegada, despacho iFood, validação oficial de quatro dígitos, progressão do gestor e acompanhamento público. Leitura das funções efetivas do banco de produção, não apenas das migrações.
2. **Problemas confirmados:** `sendIfoodArrival` aceitava `submitted` como pré-requisito da chegada externa; isso permitia avançar antes do evento oficial DISPATCHED. O workflow do site publicava sem executar as suítes de regressão no próprio job de publicação.
3. **Correções:** `entregador/ifood-departure.mjs` ganhou `dispatchBeforeArrival`; `entregador/painel.html` usa essa proteção. O registro local de chegada permanece preservado. `.github/workflows/site-deploy.yml` agora executa os testes da raiz/entregador e os testes do painel e banco isolado antes de publicar. Teste comportamental em `entregador/ifood-departure.test.mjs` cobre estados pendente, enviado, incerto, confirmado e falha de rede.
4. **Testes:** 306 testes da raiz/entregador e 66 testes do painel passaram. Backend isolado passou. O teste comprova que a chegada externa só ocorre após confirmação; não faz chamada real ao iFood.
5. **Publicação:** commit `375fb26e071f95edce6293dc24d83984586f41db` em main. Worker `pitacco-entregador` atualizado preservando seus demais arquivos/configurações; os dois arquivos publicados foram relidos pela API Cloudflare e comparados integralmente com o código testado. Workflow do site `45066544988` concluído com sucesso.
6. **Pendências:** pedido de homologação do iFood com código correto/incorreto; comportamento real em reconexão; impressão em papel; alertas com Android/Windows em segundo plano; abertura de Maps/Waze em aparelho real; 99Food restrito à integração existente. A tentativa de leitura HTTP direta do domínio do entregador a partir deste executor retornou 403; a comparação do conteúdo publicado foi realizada pela API Cloudflare.
7. **Intervenção necessária:** aparelho Android, computador/impressora e pedido isolado de homologação para verificar efeitos físicos e confirmação externa. Não foram solicitadas novas credenciais.
8. **Próximo passo:** executar esses cenários sem pedidos financeiros reais; manter falha/resultado incerto visíveis, sem reenviar despacho indiscriminadamente. A nova proteção de sequência está no fluxo da interface; não foi adicionada uma restrição equivalente à RPC de chegada nesta execução.

## 2. Fiado — núcleo testado; homologação completa pendente

1. **Verificado:** autorização do gestor, credencial do cliente, reserva de limite, aprovação manual, recebimentos parciais/totais, retransmissão idempotente, cancelamento e isolamento entre lojas.
2. **Problema confirmado:** pagamentos e saldos da caderneta não eram consultados pelo resumo financeiro geral. A função de produção `pitacco_period_financial_report` lia apenas `store_payment_receipts` para recebimentos.
3. **Correções:** integração de leitura descrita na prioridade 4. Ampliado `revisions/0.12/web/tests/backend/fiado-credit.test.sql` com aprovação manual, privacidade da resposta de pagamento do entregador e integração financeira.
4. **Testes:** reserva de R$ 20, pagamento parcial de R$ 8, saldo de R$ 12, quitação, retransmissão sem duplicação, cancelamento liberando limite e bloqueio de aceite sem aprovação passaram em banco isolado. A resposta do pagamento ao entregador é comparada com o objeto completo permitido, sem modalidade financeira, valor ou dívida.
5. **Publicação:** testes e integração no commit `d8d83aa36576e3f1ef0c8470a2a66bdb09c9365e`; migração aplicada no Supabase. O comportamento comercial da caderneta foi preservado.
6. **Pendências:** jornada completa com dois clientes autenticados em sessões distintas, cardápio, balcão e entregador reais; concorrência simultânea sobre limite de crédito não recebeu teste novo nesta execução. O teste de privacidade cobre o objeto de pagamento; não comprova ausência de qualquer termo financeiro em todos os textos livres possíveis.
7. **Intervenção necessária:** contas e pedidos isolados de homologação para os testes entre dispositivos. Nenhum pagamento real é necessário para executar os testes automatizados existentes.
8. **Próximo passo:** ampliar testes concorrentes de crédito e revisão de todas as respostas entregues ao app, antes de declarar homologação integral.

## 3. Fideliza+ — validade corrigida; pontuação/resgate incompletos

1. **Verificado:** cadastro de regras/cupons, função de checkout efetiva em produção, expiração, limite de usos, bloqueio transacional e repetição da mesma requisição.
2. **Problema confirmado:** os checkouts com cupom verificavam `expires_at` e `max_uses`, mas ignoravam `starts_at`. A busca nas funções do banco não encontrou funções de escrita de `loyalty_ledger` ou `loyalty_coupon_redemptions`; a interface também informa integração pendente.
3. **Correções:** `supabase/migrations/20261122224602_coupon_start_date_guard.sql` acrescenta o início de validade aos checkouts comum e agendado. A migração interrompe a execução caso o código existente divirja do trecho inspecionado. Testes em `revisions/0.12/web/tests/backend/checkout-variants.test.sql`.
4. **Testes:** cupom futuro e vencido recusados sem consumir utilização; cupom vigente aplicado pelo preço do servidor; retransmissão usa o cupom uma única vez. Suíte SQL completa passou.
5. **Publicação:** migração `coupon_start_date_guard` aplicada no Supabase; definição das duas funções relida e confirmação de `starts_at` e `for update`. Código no commit `cbc42caa6650b9b9691ffeef78d681f578fc3ead`.
6. **Pendências:** acúmulo/resgate transacional de pontos, registro de resgates, identidade verificada para restrição por cliente e tratamento completo de cancelamentos/estornos. Não foi ativado cashback, campanhas ou indicações.
7. **Intervenção necessária:** implementação e testes do vínculo seguro entre identidade do cliente, pedido e benefício. Não há bloqueio de credencial identificado nesta investigação.
8. **Próximo passo:** concluir a integração existente de pontuação/resgate com proteção contra duplicação e cancelamento; não anunciar essas funções como operacionais apenas por haver tela de configuração.

## 4. Financeiro e conciliação — caderneta integrada

1. **Verificado:** resumo por período, relatório de resultado por pedido, conciliação CSV e separação de vendas/recebimentos. Taxas individuais não foram alteradas.
2. **Problema confirmado:** ausência de recebimentos/saldos da caderneta no relatório geral, conforme prioridade 2.
3. **Correções:** `supabase/migrations/20261122224601_fiado_financial_report.sql` amplia `pitacco_period_financial_report` com três indicadores separados: recebimentos da caderneta, saldo aberto e reserva de crédito. `revisions/0.12/web/FinancialReport.jsx` apresenta os rótulos e explica que vendas não equivalem a dinheiro recebido. Os saldos são atuais e relativos aos pedidos criados no período; não representam um extrato histórico reconstruído na data final.
4. **Testes:** pagamento parcial aparece apenas como recebimento efetivo, saldo remanescente separado, reserva não conta como caixa e repetição não duplica dinheiro. Conciliação CSV testada para referência repetida, divergente, ambígua, não encontrada e outra loja. Custos ausentes continuam retornando resultado nulo.
5. **Publicação:** Supabase registrou `fiado_financial_report` em `20261122203122`; arquivo versionado após as migrações das tabelas de fiado, cujos timestamps do repositório estavam adiantados. Função de produção relida: indicadores presentes, acesso anon negado, acesso autenticado sujeito à verificação de gestor e `search_path` preservados. Site publicado pelo workflow `45066948523` com sucesso.
6. **Pendências:** conferência com CSV real previamente anonimizado e validação de extratos pelo operador. Os recebimentos de caixa e da caderneta permanecem linhas separadas; não foi inventado um saldo bancário unificado.
7. **Intervenção necessária:** amostra anonimizada de conciliação e conferência contábil dos resultados reais, sem lançar recebimentos fictícios em produção.
8. **Próximo passo:** homologar amostras de repasses e cenários de estorno; manter custos ausentes explícitos e não alterar cobranças automaticamente.

## 5. Intelligence — regressões verificadas, sem nova automação

1. **Verificado:** `cloudflare/admin-ai-worker.mjs`, testes de autorização, filtragem de contexto diagnóstico, incidentes, preflight e permissões de reparo.
2. **Problemas confirmados:** nenhum defeito adicional reproduzido nas rotinas cobertas pelos testes desta execução. Isso não comprova cobertura de toda divergência operacional/financeira possível.
3. **Correções:** nenhuma alteração ao assistente ou às permissões de reparo.
4. **Testes:** `tests/admin-intelligence.test.mjs` e testes SQL de incidentes/owner passaram dentro das suítes executadas.
5. **Publicação:** nenhum novo Worker administrativo publicado por esta etapa.
6. **Pendências:** injeção controlada de incidentes no ambiente de homologação, incluindo impressão física, push, dessincronização e divergência financeira.
7. **Intervenção necessária:** cenário isolado e evidência real para comparar o diagnóstico com o defeito. Não disparar reparos sensíveis em produção apenas para testar.
8. **Próximo passo:** medir cobertura e precisão dos diagnósticos com incidentes reproduzíveis, preservando trilha de auditoria.

## 6. Estoque e lucro — cobertura parcial confirmada

1. **Verificado:** ingredientes, ficha técnica de produto, movimentos imutáveis e baixa por aceite do cardápio; relatório de custos por pedido.
2. **Limites confirmados:** o consumo inspecionado calcula a ficha técnica do produto; não foi demonstrada nesta execução uma ficha de ingredientes por complemento ou integração automática completa entre estoque e custo do pedido. A regra inspecionada não define estorno automático de ingredientes após cancelamento; devolver alimento já consumido/preparado sem evidência seria incorreto.
3. **Correções:** nenhuma mudança de saldo, ficha técnica ou custo.
4. **Testes:** aceite repetido baixa uma única vez, pedido pendente não baixa, acesso de outra loja é bloqueado e custo ausente mantém resultado nulo. Testes de estoque e financeiro passaram.
5. **Publicação:** nenhuma migração de estoque nesta execução.
6. **Pendências:** consumo de complementos, embalagens, custo por receita, estorno quando cabível e cobertura dos demais canais precisam de homologação específica.
7. **Intervenção necessária:** fichas técnicas/custos reais e confirmação do tratamento de perda de produto para validar os cenários; não preencher valores por suposição.
8. **Próximo passo:** rastrear uma venda de teste com complementos e receita cadastrada, confrontando os movimentos e o resultado estimado.

## 7. Super Admin — regressões de acesso verificadas

1. **Verificado:** testes existentes de proprietário, diagnóstico, plataforma, módulos, atualizações e relatório administrativo.
2. **Problemas confirmados:** nenhum defeito novo reproduzido nos cenários automatizados inspecionados; não houve auditoria completa de todas as telas.
3. **Correções:** nenhuma alteração global, financeira ou de permissões administrativas.
4. **Testes:** suítes de platform-owner, owner-platform-dashboard, admin-homologation, app-releases, incident-monitor e inteligência passaram.
5. **Publicação:** sem nova publicação do Super Admin nesta etapa.
6. **Pendências:** homologação operacional das ações administrativas e dos instaladores em aparelhos reais. Avisos preexistentes do Supabase sobre funções SECURITY DEFINER e políticas precisam de revisão individual; sua presença, isoladamente, não comprova acesso indevido.
7. **Intervenção necessária:** conta de homologação com cada papel para testes de interface e aparelho para instalação. Consultar os avisos em https://supabase.com/dashboard/project/mdevzehqcpcgxspwbiyz/database/security-advisor . A proteção contra senhas vazadas consta como desabilitada; referência: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection . Nenhuma configuração de autenticação foi alterada nesta sessão.
8. **Próximo passo:** testar operações cotidianas com papéis distintos e decisões globais auditadas, sem mudar módulos ou planos de lojas reais para produzir evidências.

## Evidência e reprodução

- `node --test tests/*.test.mjs entregador/*.test.mjs`: 306 testes aprovados.
- Após a restauração habitual: `npm test --prefix web`: 66 testes aprovados.
- `node web/tests/backend/run.mjs`: 28 arquivos de regressão SQL aprovados, além das verificações iniciais de migração/integração.
- Build React/Vite aprovado. Aviso de bundle acima de 500 kB, sem erro de compilação.
- Nenhum navegador do usuário foi aberto. Os testes Chromium são executados pelo pipeline de homologação existente, com dados de teste.
- CI do commit financeiro confirmou PostgreSQL 17 e teste concorrente de alocação. A evidência de publicação e o estado final dos workflows devem ser conferidos nos links do GitHub, sem confundir build com instalação física.

Não encerrar a missão inteira com este relatório: os bloqueios e lacunas acima permanecem registrados para continuidade sem refazer a investigação.
