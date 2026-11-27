# Pitacco 0.12 — pedidos, entregas e rotas

## Atualizar a instalação existente
1. Faça backup do banco pelo painel Supabase e mantenha o instalador anterior.
2. No SQL Editor do mesmo projeto, execute `web/supabase/012_order_board.sql` (pode repetir) e depois **uma vez** `web/supabase/013_logistics_routes.sql`. Não execute o schema inicial sobre sua base existente.
3. Feche o Pitacco também pelo ícone da bandeja e execute `Pitacco_0.12.0_x64-setup.exe`.
4. A conexão pública, o login, a loja e a fila SQLite usam o identificador anterior do aplicativo. Não apague os dados locais ou reinstale criando uma nova operação.
5. Abra Pedidos. Atribua em Detalhes e entrega ou Despachar. Impressoras continuam em Configurações; confira o setor 80 mm já cadastrado.

A migração mantém pedidos, preços, pagamentos, entregas e fila de impressão. Rotas antigas que já tinham retirada ficam fechadas. Entregas antigas sem rota devem ser finalizadas antes de receber nova rota. O limite configurável continua de 1 a 15, conforme a validação anterior do projeto.

## Interface e regras novas
- Cartões com origem, pagamento informado, preparo e logística separados. Não significa pagamento confirmado.
- Modal de entrega no próprio pedido. Entrega de marketplace bloqueia nova atribuição. Motoboy próprio respeita loja, capacidade e saída.
- Agrupamento manual exige confirmação do possível desvio, registrada com usuário no histórico de auditoria. Distância visual é aproximada em linha reta, identificada como tal; não autoriza alocação automática.
- Entregadores tem seu próprio cadastro. Minha Loja → Entregas concentra alocação e coordenadas de saída.
- Cozinha e expedição reutiliza os estados reais de preparo e pronto; não inclui impressão independente nem funções avançadas de KDS.
- Coleta individual e saída da rota são separadas. Saída muda todas as paradas coletadas para em entrega. Uma entrega restante mantém o entregador ocupado.
- Não há cotação simulada ou contratação de Uber Direct, 99 Entregas ou iFood Sob Demanda. APIs oficiais ainda não estão integradas.

## Serviço de alocação automática (servidor)
O Windows não precisa ficar aberto para esta alocação: execute o worker em servidor contínuo com Node 22.

```sh
node web/server/dispatch-worker.mjs
```

Configure no ambiente protegido: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `ROUTING_URL` para seu serviço OSRM por HTTPS com matrizes dirigidas de tempo e distância. Nunca coloque a chave de serviço no frontend, aplicativo, repositório ou chat. O servidor público OSRM de demonstração é recusado pelo worker.

Cadastre coordenadas da loja em Minha Loja → Entregas e destino/prazo em Detalhes e entrega. Não existe geocodificação automática pronta. Ative a alocação na loja; mantenha o entregador online com GPS recente no aplicativo atualizado. Sem essas condições, o pedido permanece aguardando.

O worker consulta vias dirigidas, inclui deslocamento até a loja, recusa direções opostas, limita desvio de tempo/distância a 35%, inclui 120 segundos de serviço por parada e verifica cada prazo. Estes parâmetros conservadores estão no módulo `routeValidation.mjs`; exigem validação operacional para seu território. Não inclui trânsito ao vivo. Escolhe menor tempo viário até a loja entre candidatos válidos. Agrupamentos incertos são recusados.

A autorização para atribuir usa snapshot expiring em 30 segundos, conferido sob lock de transação; mudanças de rota, disponibilidade ou coordenadas exigem recálculo. GPS expira em 90 segundos. O worker repete a cada 10 segundos. Falha de mapas ou de API nunca vira aprovação. Mais de um worker é permitido; o banco serializa por loja e entregador. Monitore logs e configure reinício por seu gerenciador de serviços.

## Android existente
Código Flutter preservado e atualizado com heartbeat GPS em primeiro plano, coleta por pedido e botão Saiu da loja. O backend decide elegibilidade. O timer não garante GPS quando Android suspende o aplicativo; nesse caso, a expiração bloqueia novas alocações. Ainda faltam serviço de localização em segundo plano, homologação em aparelho, ocorrências e comprovação própria completa. Códigos de marketplaces continuam dependendo de validação oficial, sem aprovação local fictícia. Não há APK novo compilado neste pacote.

## Validação e limites
- Testes JavaScript: impressão, rotas, quadro, configuração e novo validador viário.
- SQL: migrações e cenários de aceite/checkout, além de atribuição, capacidade, parceiro, GPS, saída, conclusão parcial/total, auditoria, idempotência e autorização.
- PostgreSQL real no CI: concorrência de duas conexões, limite e repetição idempotente.
- Navegação automatizada com dados fictícios: quadro, aceite, pronto, modal/atribuição, localização das configurações e impressoras. Não usa banco do restaurante.
- Rust: fila persistente e formatação ESC/POS existentes, sem modificação do núcleo de impressão.
- Compilação e testes do Windows são executados no GitHub Actions. Verifique o resultado da execução correspondente antes de distribuir.
- Impressão física, notificações no seu computador, GPS real, APIs de parceiros e ciclo real até entrega não foram testados por estes testes automatizados.

## Preservado e ainda pendente
Backend do cardápio público/checkout e pagamentos manuais preservado. A interface pública completa de checkout não foi entregue neste incremento. Produtos, despesas, assinaturas administrativas e importação permanecem; assinatura não equivale a cobrança recorrente integrada. Relatórios financeiros existentes são básicos. Não há CRM completo ou relatórios avançados novos. Marketplace precisa de credenciais, webhooks autenticados, homologação e confirmação oficial. Atualizador assinado permanece desabilitado até configurar chave e endpoint. O instalador de testes não possui certificado comercial de assinatura Windows.

## Fonte e compilação
Repositório mantém o pacote 0.11 íntegro, alterações 0.11.1 em `updates/0.11.1` e este incremento em `revisions/0.12`. Para reconstruir a árvore em um checkout limpo: `python revisions/0.12/restore.py`. Depois, no Windows, `cd web`, `npm ci`, `npm test`, `npm run desktop:build -- --bundles nsis`. Pré-requisitos e impressoras: documentos WINDOWS.md e IMPRESSORAS.md existentes. Não executar restore sobre um checkout com alterações locais não salvas.
