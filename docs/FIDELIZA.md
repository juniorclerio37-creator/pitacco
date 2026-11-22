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
2. Informar nome e telefone e participar. O código de indicação é opcional no primeiro cadastro.
3. Guardar a chave pessoal. O navegador mantém o acesso; em outro aparelho, o cliente pode colar a chave. Somente conhecer o telefone não permite consultar ou gastar o saldo.
4. Na compra, selecionar um cupom/campanha ou um resgate, tocar em **Aplicar benefício** e conferir o desconto.
5. Confirmar o pedido. Em caso de conexão incerta, **Tentar novamente** consulta a mesma requisição, sem novo débito.

O cliente pode consultar saldos e movimentações sem comprar. Cupons e campanhas exclusivos aparecem apenas na carteira do participante escolhido. A carteira se atualiza enquanto estiver aberta; o painel também atualiza as carteiras periodicamente. Após enviar o pedido, o acesso à carteira não reabre a confirmação de compra.

Se perder a chave, o gestor pode usar **Clientes e pontos → Recuperar acesso**, após confirmar a identidade da pessoa. A chave anterior é revogada. Não há recuperação por telefone sem verificação, nem dependência de SMS/WhatsApp para funcionar.

## Regras operacionais

- Acúmulo somente após pagamento integral e entrega/retirada confirmados; o módulo não conclui pedidos.
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

As carteiras e vínculos são privados. Movimentos e resgates não podem ser escritos diretamente por clientes ou entregadores. As funções de cliente verificam a chave e a loja; funções de gestão verificam o gestor. Configurações, recuperação de chave, reservas, créditos e reversões possuem histórico.

Testes versionados:

- `revisions/0.12/web/tests/backend/fideliza-runtime.test.sql`: modalidades, idempotência, saldo, cancelamento/estorno, indicação, acesso indevido, recuperação, fiado, frete e agendamento.
- `revisions/0.12/web/tests/backend/concurrency.mjs`: dois resgates simultâneos sobre a mesma carteira e repetição simultânea de checkout.
- `tests/fideliza.browser.mjs`: cliente e gestor, celular/computador, modalidades, sacola, desconto, envio repetido e consulta da carteira após comprar.

Nenhum pedido real, saldo histórico, taxa de marketplace ou plano precisa ser modificado para executar essas validações.
