# DeliveryGestor 0.2 — MVP online

Sistema web React + Vite + Supabase para gestão de múltiplas lojas de delivery.

## Configuração
1. Crie um projeto no Supabase (https://supabase.com) e habilite autenticação por e-mail.
2. No SQL Editor do projeto **novo**, execute `supabase/schema.sql` integralmente.
3. Copie `.env.example` para `.env`. Insira URL do projeto e chave **publicável/anon** (NUNCA a service_role).
4. Execute `npm install` e `npm run dev` para abrir localmente. `npm run build` gera a versão para hospedagem estática.
5. Cadastre sua conta pela tela do aplicativo e confirme o e-mail, caso exigido.
6. No SQL Editor, promova apenas a sua conta: `update public.profiles set role='admin' where email='seu-email@exemplo.com';`. Saia e entre novamente.
7. Crie uma loja no painel Lojas. Peça ao lojista para criar conta; depois vincule o e-mail dele na aba Equipe.

## Permissões
- Admin: todas as lojas, cadastro de lojas, controle de assinaturas, equipe.
- Gestor: lojas autorizadas, pedidos, produtos, despesas e convite de usuários já cadastrados.
- Lojista: somente lojas autorizadas, pedidos, produtos, despesas e consulta de assinatura.
- Políticas RLS restringem consultas e gravações no banco. Cadastro de admin exige ação manual no SQL Editor.

## Limitações atuais
- Sem integração oficial com iFood/99Food, cobrança Pix, disparo de e-mails, importação de planilhas ou hospedagem pública.
- Os dados são salvos no Supabase configurado, não em localStorage.
- O registro de assinatura é administrativo e **não bloqueia** o acesso por inadimplência.
- A aplicação precisa de validação em um projeto Supabase real antes de uso comercial; revise permissões, proteção contra abuso, recuperação de senha e privacidade/LGPD.
- O cadastro da equipe exige que o usuário já tenha uma conta. Não há envio automático de convites.

## v0.3 — Módulo web de entregas
Em projetos v0.2 existentes, execute **somente** `supabase/003_delivery.sql` no SQL Editor depois do esquema original. Em projetos novos, execute `schema.sql` e depois `003_delivery.sql`.
- Loja: configura frota própria, compartilhada ou ambas; cria e atribui entregas.
- Plataforma: admin cadastra frota compartilhada e pode atribuir seus entregadores.
- Entregador: cadastra-se por e-mail no Auth antes de ser vinculado; acessa aba Entregas e altera o status de suas entregas.
- Transições validadas no servidor: pendente → atribuída → aceita → retirada → entregue. Cancelamento pelo gestor antes da aceitação.
- Segurança: RLS para leitura e RPCs com validação para escrita. Entregador não pode visualizar entregas alheias.
- Limitações: sem rastreamento GPS, mapa de rotas, notificações push, comprovante fotográfico, cálculo automático de distâncias, pagamentos ou conexão real com marketplaces. A frota compartilhada requer atribuição pelo administrador; não há leilão/aceite público de corridas.
- Antes de produção: testes de segurança multiempresa, LGPD, gestão de permissões, tratamento de erros, observabilidade e homologação de integrações.

## v0.4 — Central de despacho em lote
- Execute `supabase/006_dispatch_batches.sql` **após** `schema.sql` e `003_delivery.sql` (e, se aplicáveis, as migrações 004/005 do aplicativo de entregadores).
- Aba **Entregas**: seleção de 2–15 entregas, escolha de entregador, despacho atômico via RPC `assign_delivery_batch`, indicação visual do lote e atualização manual da lista.
- Permissões seguem a v0.3: frotas próprias para gestores autorizados; frota compartilhada atribuída somente por admin.
- O lote não calcula rota: a otimização é responsabilidade do aplicativo Flutter/serviço de rotas. Ainda não há atualização push, geolocalização ao vivo nem distribuição automática por proximidade.
- Migração e UI não foram validadas em Supabase real; teste com usuários de diferentes lojas antes de uso comercial.

## v0.5 — entrega parceira (iFood, 99Food, Keeta)
Execute `supabase/007_marketplace_logistics.sql` após as migrações 003–006 e 005 do aplicativo Flutter.
O campo `source` representa a origem do pedido; `logistics_provider` representa quem entrega.
`marketplace` = entrega parceira: aparece na central web, não é atribuível à frota própria/compartilhada e não aparece no APK do motoboy.
`loja` = entregas próprias ou frota compartilhada: elegíveis a despacho manual/automático e roteirização.
O formulário web de entrega parceira é lançamento manual para testes; não implica API integrada. O status de entrega parceira deve ser atualizado futuramente por backend que valide os webhooks oficiais, sem permitir conclusão manual pelo APK. Não armazene códigos de entrega da plataforma nesse cadastro.
**Teste essencial**: criar pedido iFood/entrega parceira com modo automático ativado; verificar que courier_id continua NULL. Tentar assign_delivery e assign_delivery_batch e verificar rejeição. Criar pedido delivery próprio e confirmar despacho normal. Conferir políticas RLS em ambiente Supabase real.

## v0.6 — importação e entregas externas

Execute `supabase/008_imports_external_delivery.sql` após as migrações anteriores.

- **Importação:** aba "Importar cardápio" aceita CSV simples (`nome;categoria;descricao;preco`) ou JSON de itens com chaves `name`, `category`, `description`, `price`. Os registros entram em `menu_import_staging` para revisão, não são publicados. Exportações reais dos marketplaces podem ter formatos diferentes e precisarão de adaptadores específicos. Não há acesso automático às APIs, imagens ou complementos nesta versão.
- **Entrega externa:** aba "Entrega externa" salva solicitações como rascunho para 99 Entrega, Uber Direct ou iFood sob demanda. Nenhum pedido é efetivamente contratado, cobrado ou enviado ao provedor. Para produção: API autorizada, cotação, consentimento, confirmação, webhook autenticado, idempotência e conciliação.
- **Pedido único:** o painel de entregas já permite atribuir uma entrega individual; lote é opcional. Agrupamento por direção/tempo real ainda NÃO foi implementado e não deve ser anunciado como automático. Futuro algoritmo deverá consultar rotas viárias, janelas de entrega, capacidade e consentimento, rejeitando agrupamentos com desvio excessivo.
- **Segurança:** acesso às tabelas restrito por RLS a gestores autorizados. As credenciais dos parceiros deverão ficar apenas no servidor.


## v0.7 — Importação com fotos e distribuição configurável

Execute `supabase/009_menu_images_dispatch_policy.sql` após 008. Em **Importar cardápio**, envie CSV, JSON ou ZIP com `menu.json` / `produtos.json` / `menu.csv` / `produtos.csv` e fotos PNG/JPG/WebP. Em cada produto, indique `image` com o nome/caminho da foto dentro do ZIP. Exemplo: `[{"id":"1","name":"Açaí 500ml","price":22.9,"image":"fotos/acai.jpg","adicionais":[{"nome":"Granola","preco":2}]}]`. Os dados originais dos complementos são preservados em `raw_data`; a publicação e edição dos adicionais ainda exigem módulo posterior. Fotos são enviadas ao bucket privado `menu-import-images`, com permissão por loja. Arquivos com URL de foto guardam apenas a referência, sem copiar automaticamente a imagem. Limites: 500 itens, 500 fotos, 5 MB por foto.

Em **Entregas**, configure `manual`, `automatico` ou `misto`, além do limite de 1 a 15 pedidos por viagem. O botão automático atribui **um pedido pendente a um entregador livre** com permissão. Não há motor de rotas ou avaliação de contramão nesta versão. O botão de anexar permite acrescentar um pedido pendente a uma viagem ainda não iniciada, respeitando o limite. Entregas do marketplace com logística parceira permanecem excluídas.

**Limitações:** integração por API com iFood, 99Food e Keeta, importação direta de fotos pelas APIs, otimização de rotas, sincronização com o APK e testes Supabase reais continuam pendentes. Execute `npm install` e `npm run build` num ambiente com acesso ao registro npm.

## v0.8 — Assistente de rotas (experimental)
- `routeEngine.mjs`: algoritmo testável de agrupamento por direção geográfica, desvio estimado e limite de pedidos; exclui logística de marketplace.
- Interface **Assistente de rotas** na central de entregas: entrada manual das coordenadas de origem, prévia dos pedidos elegíveis e motivos de exclusão. Os destinos precisam ter `latitude`/`longitude` disponíveis nos registros (a tela de cadastro ainda não coleta essas coordenadas).
- O assistente **não atribui entregas** automaticamente e não usa vias reais: não deve ser utilizado para decidir rotas comerciais sem validação humana.
- Testes: `node --test tests/*.test.mjs`.
- Próximo passo: geocodificação dos endereços com consentimento e provedor de mapas, matriz de tempo de viagem, restrições de prazo, política de custo e despacho transacional no Supabase.

## v0.9 — Motor viário de testes

- `roadOptimizer.mjs`: otimização com matriz de tempo **direcional** (ruas e contramão) e restrição de desvio; exclui pedidos com entrega parceira e respeita limite de 1 pedido.
- A tela **Rotas viárias (modo de teste)** consulta o servidor público de demonstração OSRM. **Não use endereços reais de clientes neste serviço público**: os pontos são transmitidos a um terceiro. O serviço pode bloquear requisições, tem limites e não oferece SLA nem tráfego em tempo real.
- Sem matriz viária, a sugestão falha explicitamente. Nenhuma entrega é atribuída automaticamente pelo motor de rotas.
- A função anterior `auto_assign_delivery` continua atribuindo um único pedido a um entregador livre, **sem** otimização viária. Não confundir com despacho por proximidade.
- Antes de produção, trocar o endpoint por serviço privado/contratado, geocodificar endereços de forma segura, respeitar prazos de coleta e entrega, adicionar atribuição atômica no banco e integrar APK.
- Testes: `node --test tests/*.test.mjs`.
