# Preservação da integração iFood na migração
Objetivo: reaproveitar os componentes existentes, evitar nova aplicação ou revogação de autorizações sem necessidade, e preservar todos os contratos homologados. A troca de infraestrutura não é uma garantia de dispensa de rehomologação. Confirmar por escrito com o suporte do iFood, no Portal do Desenvolvedor, os módulos e o método de eventos aprovados para a aplicação de produção antes de qualquer corte. Não confundir testes de regressão do Pitacco com homologação do provedor.

## Componentes existentes
- `supabase/functions/ifood-orders/handler.mjs`: recepção, verificação de assinatura, fila, detalhes do pedido, confirmação, preparo e despacho, operações do entregador.
- `supabase/functions/ifood-orders/distributed.mjs`: vínculo por merchant, credenciais protegidas, renovação, polling e acknowledgment.
- `supabase/functions/ifood-orders/shipping-events.mjs`, `supabase/functions/ifood-shipping/requests.mjs`, `supabase/functions/ifood-shipping/index.ts`: eventos e operações logísticas.
- SQL original: vínculos, filas, leases, idempotência, transições, regras de despacho e permissões de entregadores. Reutilizar contratos verificados, não reconstruir por aproximação.
- Aplicações existentes: painel, Windows e entregador devem manter os fluxos e estados corretos.

## Transição
1. Manter a integração de produção atual sem alterações. Não criar nova aplicação iFood nem trocar Client ID/Secret automaticamente.
2. Recuperar privadamente credenciais, chaves de cifragem e vínculos por loja, mantendo UUIDs e escopos. Não incluir segredos ou dados reais no GitHub.
3. Restaurar o SQL e testar o novo backend com dados fictícios e ambiente de teste; adaptar a comunicação de cada componente existente à API interna autenticada, sem expor RPC arbitrário. Não habilitar chamadas externas de teste com credenciais de produção.
4. Executar os testes existentes de Order/Events, Shipping e entregador a cada alteração relevante na branch. Validar assinatura, isolamento, confirmação persistida, ACK, renovação, cancelamento, despacho e código de entrega; validar também prevenção de duplicidade e recuperação após indisponibilidade.
5. Fazer testes integrados em ambiente isolado, confirmar o escopo homologado com iFood e obter aprovação da mudança se exigida. O teste interno não substitui essa decisão.
6. Na troca autorizada, garantir um único consumidor ativo por fluxo/merchant, incluindo polling e webhooks. Preservar a URL pública quando compatível com as regras do provedor; transferir filas e estados de maneira consistente. Não espelhar chamadas externas de escrita. Reconciliar eventos recebidos/pendentes e validar conectividade.
7. Definir rollback que restaure o consumidor anterior sem repetir aceite, despacho, cancelamento ou pedido. Manter a operação atual se qualquer gate falhar.

## Evidência
Workflow `core-ifood-preservation.yml` executa os testes de código existentes com mocks, sem segredos reais. A primeira execução é pendente. Não é uma certificação de que o backend Laravel já processa iFood, nem comprova quais módulos foram homologados. Não houve contato com o suporte nem alteração no ambiente de produção.

Referências oficiais:
- https://developer.ifood.com.br/en-US/docs/food/guides/modules/events/homologation
- https://developer.ifood.com.br/en-US/docs/food/guides/modules/order/homologation
- https://developer.ifood.com.br/en-US/docs/food/guides/modules/events/webhook-signature
- https://developer.ifood.com.br/en-US/docs/food/guides/modules/logistics/homologation

### Resultado da primeira regressão dedicada
Em 27/11/2026, os 41 testes existentes passaram (0 falhas): https://github.com/juniorclerio37-creator/pitacco/actions/runs/46014284208 . Esse resultado confirma apenas o comportamento dos componentes originais sob mocks, sem alterações da integração ou comprovação de homologação do novo backend.
