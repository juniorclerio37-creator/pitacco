# PagBank Connect — sandbox
- Aplicação Pitacco registrada pela API Connect. Credenciais no Supabase Vault (nunca no Git).
- OAuth: conta Sandbox da loja de homologação, state aleatório, validade 10 minutos, consumo único. Escopos payments.read e payments.create.
- A função pagbank-connect implementa autorização, callback, cobrança Pix de teste, consulta autenticada, imagem PNG e webhook SHA-256 seguido de consulta independente do pedido.
- Teste de plataforma em 25/11/2026 (UTC): cobrança fictícia R$ 1,00 criada, QR Code PNG recebido e PAID confirmado por consulta oficial. Não é teste de conta de lojista.
- Conta de lojista ainda precisa autorizar no Sandbox; assinatura de webhook para Connect e renovação de token ainda não validadas. Token expirado bloqueia cobrança.
- Sem alterações nos pedidos reais, produção, Asaas ou templates públicos. A integração pública requer credenciais de produção, homologação, reserva de estoque, validação de preço e taxa no servidor, confirmação idempotente, expiração/estorno, reconciliação e testes integrados.
- A interface de homologação permite iniciar autorização e cobrar R$ 1,00 fictício na loja marcada para homologação. Não se deve pagar QR Sandbox com dinheiro real.

## Isolamento dos vendedores
Cada estabelecimento autoriza a própria conta via Connect. O account_id retornado pelo PagBank é obrigatório, único entre lojas e diferente da conta da aplicação. A autorização é vinculada ao gestor autenticado e à loja; cobrança sem loja ou tentativa de trocar titular é recusada. Cobranças guardam o account_id original e consultas usam exclusivamente o token daquela loja. Não há fallback para o token da plataforma. A identidade jurídica do titular deverá ser validada no onboarding de produção; Sandbox não comprova titularidade bancária real.
