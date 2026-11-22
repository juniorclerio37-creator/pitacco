# Fideliza+ integrado ao cardápio

Cada loja configura suas modalidades no painel, em **Fideliza+**. A disponibilização das funções não ativa campanhas financeiras em todas as lojas: as opções e os valores escolhidos por cada gestor são preservados.

| Modalidade | Configuração e uso |
|---|---|
| Pontos | Taxa por real em produtos, quantidade necessária e desconto do resgate. |
| Recompensa por pedidos | Número de compras válidas necessário e valor do benefício. |
| Cupons | Valor fixo/percentual, mínimo, período, limite total, limite por participante e cliente exclusivo. |
| Campanhas | Ofertas com nome, código, condições e datas; campanhas públicas vigentes aparecem no cardápio. |
| Cashback | Percentual de crédito e limite percentual para resgatar em uma nova compra. |
| Indique e ganhe | Código/link de cada participante, crédito do indicador e do novo participante após a primeira compra elegível. |

## Jornada do cliente

1. Abrir **Meu Fideliza+** no cardápio da loja.
2. Informar nome e telefone com DDD e confirmar o SMS para acessar a carteira. O código de indicação é opcional no primeiro cadastro, antes da primeira compra.
3. O programa vincula os benefícios ao telefone com DDD. Para consultar saldo ou resgatar vantagens, o cliente confirma seu número por código temporário enviado por SMS. Não existe chave pessoal para guardar ou copiar.
4. Na compra, selecionar um cupom/campanha ou um resgate, tocar em **Aplicar benefício** e conferir o desconto.
5. Confirmar o pedido. Em caso de conexão incerta, **Tentar novamente** consulta a mesma requisição, sem novo débito.

O cliente pode consultar saldos e movimentações sem comprar, após confirmar seu telefone por SMS. Cupons e campanhas exclusivos aparecem apenas na carteira do participante escolhido. A carteira se atualiza enquanto estiver aberta; o painel também atualiza as carteiras periodicamente. Após enviar o pedido, o acesso à carteira não reabre a confirmação de compra.

Não é preciso recuperar uma chave. Em outro aparelho, o cliente confirma o mesmo telefone por SMS e acessa seus benefícios. A identificação do cliente e o acúmulo automático permanecem vinculados ao telefone da compra; a autorização de consulta e resgate depende da confirmação do número.

## Regras operacionais

- Nas compras do cardápio digital, a carteira é identificada pelo telefone do pedido mesmo sem login, mas o saldo só é acumulado após pagamento integral e entrega/retirada confirmados; o módulo não conclui pedidos.
- Base: produtos após descontos. Frete não gera benefício. Produtos totalmente descontados não geram pontos, participações ou indicação.
- Pedidos de fiado acumulam depois de entregues e integralmente quitados. Para resgatar desconto, escolher pagamento no pedido.
- Um desconto por pedido: cupom/campanha **ou** pontos, recompensa por pedidos ou créditos. Resgates não descontam o frete.
- Resgates deixam pelo menos R$ 0,01 em produtos. O limite de uso de créditos é configurado pela loja.
- Regras ficam vinculadas ao pedido. Alterações do programa valem para pedidos novos.
- Cancelamento, rejeição, cancelamento da entrega e estorno integral confirmado geram reversão; não apagam movimentos.
- Se o benefício de uma venda já foi gasto e a venda original é cancelada, o saldo interno pode ficar negativo. Novos créditos compensam esse valor; nenhum saque ou cobrança financeira é realizado pelo Fideliza+.
- Indicação exige outro participante, outro telefone e compra elegível. Repetir o pedido ou confirmar novamente não gera novo prêmio.
- Novos benefícios não são atribuídos retroativamente a pedidos históricos usando apenas telefone.

## Segurança e validação

As carteiras e vínculos são privados. Movimentos e resgates não podem ser escritos diretamente por clientes ou entregadores. O acesso à carteira exige telefone confirmado via Supabase Auth (SMS), com sessão técnica temporária, interna e nunca mostrada ao usuário. Sessões são vinculadas a `auth.uid()`, loja e cliente. Configurações, reservas, créditos e reversões possuem histórico.

Testes versionados:

- `revisions/0.12/web/tests/backend/fideliza-runtime.test.sql`: modalidades, idempotência, saldo, cancelamento/estorno, indicação, acesso indevido, recuperação, fiado, frete e agendamento.
- `revisions/0.12/web/tests/backend/concurrency.mjs`: dois resgates simultâneos sobre a mesma carteira e repetição simultânea de checkout.
- `tests/fideliza.browser.mjs`: cliente e gestor, celular/computador, modalidades, sacola, desconto, envio repetido e consulta da carteira após comprar.

Nenhum pedido real, saldo histórico, taxa de marketplace ou plano precisa ser modificado para executar essas validações.

## Requisito para SMS

A autenticação por telefone utiliza o Supabase Auth (`signInWithOtp` e `verifyOtp`) e depende de um provedor de SMS ativo no projeto. Esse serviço pode gerar cobranças do provedor; enquanto indisponível, compras comuns continuam funcionando e podem acumular benefícios, mas consulta e resgate permanecem protegidos. Nenhum fluxo público libera carteira apenas com um telefone digitado.
