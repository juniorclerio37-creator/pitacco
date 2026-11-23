# Fideliza+ — identificação automática pelo celular

Cada loja escolhe quais módulos disponibilizar e seus respectivos valores no painel, em **Fideliza+**. A implantação não ativa campanhas ou recompensas para todas as lojas automaticamente.

## Jornada do cliente no cardápio digital

1. O cliente adiciona produtos e informa seu nome e **telefone celular com DDD** no checkout.
2. O cardápio consulta a carteira daquela loja automaticamente e apresenta pontos, quantidade de pedidos, créditos e benefícios; **não existe senha, chave pessoal, SMS nem botão de cadastro/login**.
3. Se for a primeira compra com aquele telefone, o sistema cria a carteira ao confirmar o pedido, dentro da própria transação. Antes disso, a pontuação aparece zerada.
4. Na compra seguinte, basta digitar o **mesmo telefone** para ver os saldos anteriores.
5. O cliente pode usar um cupom, uma campanha ou escolher resgatar pontos, recompensas por pedidos ou cashback, respeitando as regras e limites escolhidos pelo lojista.

O telefone pertence ao cadastro da loja, e não a uma carteira global entre estabelecimentos. O CPF não é solicitado.

## Regras operacionais

- Os benefícios são contabilizados **somente após pagamento e entrega/retirada confirmados**. Fiado acumula após quitação integral.
- Produtos após descontos formam a base de cálculo; frete não pontua.
- Um pedido utiliza **um** desconto: cupom/campanha **ou** resgate de pontos, pedidos ou cashback.
- Os resgates não abatem frete e deixam pelo menos R$ 0,01 em produtos.
- Reserva de saldo, uso de cupom e idempotência de pedidos continuam controlados no banco; pedidos duplicados não podem gastar o benefício duas vezes.
- Pedidos cancelados, rejeitados ou estornados revertem os benefícios conforme as regras existentes.
- Indicações precisam de números distintos e premiam a primeira compra elegível concluída. O código opcional é informado no primeiro pedido.
- Pedidos históricos não recebem benefícios retroativos apenas pela identificação do número.

## Limites de privacidade e segurança desse modelo

O modelo **sem verificação do número** favorece a rapidez, mas tem uma limitação importante: uma pessoa que souber o telefone de outra pode consultar os totais e tentar utilizar os benefícios desse número. O risco existe mesmo com a conferência do telefone do pedido, pois o cliente controla o número digitado.

Para reduzir a exposição, a consulta pública disponibiliza apenas os totais de pontos, compras e créditos e as ofertas da loja: não retorna nome, endereço, histórico individual de transações ou outras informações pessoais. A movimentação é processada pelo checkout, não por escrita direta no livro de saldos. Cupons e recompensas permanecem limitados à loja e aos critérios do servidor.

O lojista deve considerar esse risco ao ativar descontos com valor financeiro. Uma confirmação adicional para resgates pode ser adicionada posteriormente sem mudar a consulta automática de pontos.

## Testes

- `revisions/0.12/web/tests/backend/fideliza-runtime.test.sql`: acúmulo por telefone, recompensas, limites, compras, devolução, estornos, indicação, fiado, frete e agendamento.
- `revisions/0.12/web/tests/backend/concurrency.mjs`: concorrência, reserva de saldo e idempotência.
- `tests/fideliza.browser.mjs`: tela do cliente e lojista no celular e computador, atualização automática pelo telefone, cupom, resgate, checkout e retry.
