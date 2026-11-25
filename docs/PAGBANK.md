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

## Prévia protegida do checkout
O gestor de uma loja Sandbox vinculada cria um link com token aleatório de 256 bits, armazenado apenas como hash, válido por 30 minutos e restrito a uma cobrança. A prévia usa o cardápio e template reais, sem alterar o checkout normal, perfil, fidelidade ou pedidos operacionais. Nesta fase a prévia suporta retirada; o backend de teste valida também cotação de frete e cupom comum, ainda não verificados em fluxo completo. O servidor calcula valores e complementos, fixa a conta recebedora e bloqueia divergência de valor. O pagamento fictício nunca libera pedido real. Renovação OAuth com lease e rotação atômica no Vault está implementada, ainda não exercitada contra o PagBank. Estorno e confirmação de webhook precisam de testes oficiais antes da produção.

A criação do link de teste fica bloqueada até o servidor confirmar que a página publicada contém a proteção Sandbox. Não abrir a prévia num checkout antigo.
