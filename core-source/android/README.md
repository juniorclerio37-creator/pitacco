# DeliveryGestor Entregador — Flutter Android (código-fonte v0.1)

## O que existe
- Login/cadastro com Supabase Auth e vínculo a entregador cadastrado pelo gestor.
- Lista de entregas atribuídas ao usuário autenticado, limitada por RLS.
- Aceitar, marcar retirada e concluir via RPCs validadas no servidor.
- Abrir rota no Google Maps, disponibilidade online/offline e soma dos repasses das últimas 100 entregas.
- Atualização por Supabase Realtime e polling de segurança a cada 30 s.
- Registro do token Firebase Cloud Messaging para permitir um emissor de push no servidor.
- SQL para escolha entre despacho automático e manual por loja; frota própria e compartilhada.

## Pré-requisitos
Flutter SDK, Android SDK, Java, projeto Supabase e projeto Firebase Android.
**Este pacote não contém APK compilado**: Flutter/Android SDK não estavam disponíveis no ambiente de criação.

## Preparação do banco
Em banco novo, execute `deliverygestor/supabase/schema.sql`, depois `003_delivery.sql` do projeto web v0.3, depois `supabase/004_dispatch_mobile.sql` deste pacote.
Em banco existente v0.3, execute apenas `004_dispatch_mobile.sql`.
Ative Realtime na tabela `public.deliveries` (Database > Publications). RLS continua obrigatório.
O gestor cria o entregador pelo painel web existente. Entregador precisa ter conta Auth antes do vínculo.
O gestor configura o modo por RPC `set_store_dispatch_mode(s, mode)` (`manual` ou `automatica`). A interface web para essa opção ainda precisa ser adicionada.

## Flutter e Firebase
1. Crie o projeto Android nativo a partir destes fontes: `flutter create --platforms android .` (dentro da pasta).
2. No Firebase Console, cadastre um app Android com o `applicationId` definido no projeto e baixe `google-services.json` para `android/app/`.
3. Configure FlutterFire com `flutterfire configure` e siga a configuração Android do plugin Firebase, incluindo o Google Services Gradle plugin. A versão do projeto gerado pelo Flutter determina a sintaxe Gradle correta.
4. Em AndroidManifest.xml adicione `<uses-permission android:name="android.permission.INTERNET"/>` e `<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>` como filhos de `<manifest>`.
5. `flutter pub get`
6. `flutter run --dart-define=SUPABASE_URL=https://SEU-PROJETO.supabase.co --dart-define=SUPABASE_ANON_KEY=SUA_CHAVE_PUBLICA`
7. `flutter build apk --release --dart-define=SUPABASE_URL=... --dart-define=SUPABASE_ANON_KEY=...`
8. APK gerado em `build/app/outputs/flutter-apk/app-release.apk` quando o build for bem-sucedido.

**Não inclua chave `service_role`, segredos do Firebase nem credenciais privadas no aplicativo.**

## Notificações
O app solicita permissão de notificações e registra o token FCM em `courier_device_tokens`. **Ainda não há envio automático de push pelo servidor**: implemente uma Edge Function protegida que detecte novas atribuições, leia tokens com credenciais do servidor e envie via Firebase Admin/FCM HTTP v1, com autenticação Google de serviço. Não exponha a chave do Firebase no Flutter. Até lá, novas entregas são vistas por Realtime ou atualização periódica.

## Limitações e segurança antes de produção
- O modo automático escolhe o entregador disponível com menos entregas abertas, sem cálculo de distância, GPS ou aceite concorrente por oferta; ele atribui diretamente a entrega. Se ninguém estiver disponível, a entrega fica pendente para despacho manual.
- O app não tem botão de recusa; para recusa/reoferta, implemente RPCs transacionais e regras de timeout.
- O valor exibido é repasse cadastrado, não pagamento confirmado. Não existe módulo de liquidação financeira.
- Falta localização em tempo real, prova de entrega, testes Android reais, CI, logs e política LGPD.
- A migração precisa ser validada em Supabase de testes e submetida a auditoria RLS/multiempresa antes de uso comercial.
- Atenção: o fluxo de cadastro e políticas de token deve ser testado com múltiplas lojas; não use em produção sem isso.

## v0.2 — Roteirização e código obrigatório
- Execute `supabase/005_routes_and_delivery_codes.sql` após a migração 004.
- `geolocator` pede GPS **somente quando o entregador toca em Otimizar sequência**; `geocoding` converte endereços em coordenadas. Adicione `ACCESS_FINE_LOCATION` e `ACCESS_COARSE_LOCATION` no AndroidManifest, além das permissões já documentadas. Configure política de privacidade e consentimento LGPD.
- A ordenação usa heurística do vizinho mais próximo e distância **em linha reta**, não é otimização viária nem considera trânsito/prazos. O Google Maps recebe a sequência como waypoints, mas pode impor limites de paradas. Endereços ambíguos podem produzir rotas erradas; revise antes de sair.
- A rota considera entregas `aceita` e `retirada`; o entregador pode aceitar pedidos antes de calcular. A sequência não é salva no servidor.
- Para entregas `requires_delivery_code=true`, a interface solicita código e chama a Edge Function `verify-marketplace-delivery`. O esqueleto fornecido responde **501**, sem validar. Implemente adaptadores homologados das APIs do iFood/99Food; **não marque verificado por comparação local**. O SQL bloqueia a conclusão até `delivery_code_verified_at` ser registrado por backend autorizado. A política de RLS atual não concede atualização direta ao entregador.
- **Importante:** o fluxo existente `create_delivery` cria pedidos `proprio`. Pedidos externos devem ser inseridos por serviço de integração confiável definindo `source` e `requires_delivery_code` corretamente. Os requisitos de cada plataforma devem ser conferidos antes de ativar a sincronização.
- A Edge Function deve validar a identidade JWT do entregador, associação à entrega, taxa de tentativas, e somente após resposta oficial positiva registrar a confirmação com credenciais de servidor. Nunca distribuir `service_role` no APK.
- FCM continua com registro de token, **sem serviço de envio**; o aplicativo usa Realtime/polling para atualizar a lista.
- **Não compilado:** Flutter e Android SDK indisponíveis neste ambiente. `flutter create --platforms android .`, `flutter pub get`, `flutter analyze`, `flutter build apk` e testes em aparelho são pendentes.
