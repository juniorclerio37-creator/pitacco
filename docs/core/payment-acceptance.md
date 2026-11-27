# Pitacco Core — homologação integral dos pagamentos

## Escopo obrigatório para migração
Preservar métodos, configurações por loja, separação entre cardápio e balcão, registros de pagamentos, histórico, preços publicados e integrações existentes. Não reduzir funcionalidades para fazer a migração passar. A integração online dependente de homologação externa deve manter o estado de disponibilidade original, sem habilitar cobranças reais antes da aprovação do provedor.

## Inventário verificado no código
| Modalidade | Identificador original | Situação Laravel em 27/11/2026 |
|---|---|---|
| Dinheiro no recebimento, com/sem troco | dinheiro | Checkout pendente |
| Crédito na maquininha | cartao_credito | Checkout pendente |
| Débito na maquininha | cartao_debito | Checkout pendente |
| Cartão na entrega (compatibilidade) | cartao_entrega | Checkout pendente; preservar mapeamento crédito/débito |
| Pix na maquininha | pix_maquininha | Checkout pendente |
| Pix manual | pix_manual | Checkout experimental aprovado; confirmação e interfaces completas pendentes |
| Alelo | voucher_alelo | Checkout pendente |
| Pluxee/Sodexo | voucher_pluxee | Checkout pendente |
| VR | voucher_vr | Checkout pendente |
| Ticket | voucher_ticket | Checkout pendente |
| Fiado | fiado | Gestão, PIN e extrato experimental aprovados; checkout Laravel pendente |
| Pix online | pix_online | Fluxo PagBank de prévia protegida/sandbox existente no cardápio original; integração Laravel e homologação externa pendentes |
| Cartão online | cartao_online | Identificador/label existente no cardápio; integração e homologação pendentes |

Fontes: marketing/cardapio.html; backend/app/Http/Controllers/PublicCheckoutController.php; backend/app/Services/PublicCheckout.php; supabase/migrations/20261126105458_channel_payment_methods.sql; 20261126113011_split_payment_settings.sql; 20261126113339_confirmed_payment_prices.sql; 20261124003000_cash_change_structured_checkout.sql; migrações PagBank sandbox de 20261125. A presença de rótulo no frontend não prova integração online ativa.

## Matriz de aceitação
- Todos os métodos: somente opções habilitadas pela loja e pelo canal; nenhum método desabilitado pode ser aceito diretamente pela API; isolamento entre estabelecimentos; retirada, entrega padrão/prioritária, agendamento; preço final calculado pelo servidor, revisão de preço, cupom elegível, estoque, recuperação e retentativa idempotente.
- Dinheiro: valor exato, troco solicitado, recusa de troco inferior ao total; comprovante e informação ao entregador consistentes.
- Maquininha: crédito, débito, Pix e quatro vouchers; confirmação autorizada de recebimento, cobrança apenas quando devida; compatibilidade com cartao_entrega.
- Pix manual: instruções cadastradas pela loja, estado pendente até confirmação autorizada, ausência de cobrança duplicada na entrega; conferir registro financeiro.
- Fiado: gate específico já documentado, não tratar como dinheiro ou Pix; limites privados, PIN original, reserva e cancelamento, sem benefícios, entregador sem cobrança.
- Pagamentos online: integração específica com provedor homologado, valor e identidade da loja no servidor, expiração, webhook autenticado e idempotente, conciliação, reembolso e recuperação; jamais confiar em confirmação do navegador. Usar sandbox/dados fictícios durante desenvolvimento. Não armazenar dados brutos de cartão.
- Configuração: publicação do cardápio não sobrescreve pagamentos; métodos PDV independentes do cardápio; respeitar regras de preço publicadas e a exclusão de Fiado/vouchers desses ajustes.
- Interfaces: checkout real V2, painel do lojista, Windows, Android entregador, impressão, relatórios e Control Center conforme a responsabilidade de cada interface.
- Fideliza+: consultar carteira com titularidade verificada, permitir benefícios somente quando elegíveis e registrar efeitos uma única vez.
- Assinaturas Pitacco/Asaas: cobrança da plataforma separada de pagamentos de pedidos; preservar planos e regras vigentes, homologar também sem cobrança real.

## Sequência
1. Integrar pagamentos no recebimento e Pix manual, respeitando contratos originais e permissões por canal.
2. Homologar checkout Fiado (envio anterior bloqueado; não há implementação Laravel registrada).
3. Integrar pagamentos online conforme disponibilidade e homologação de cada provedor; não simular aprovação como se fosse produção.
4. Validar interfaces, conciliação, relatórios, segurança, concorrência, restauração e corte controlado.
5. Nenhuma troca de backend até aprovação dos gates de migração.

Este documento é uma matriz de requisitos, não uma certificação de funcionamento. Os testes aprovados até aqui são experimentais, com dados fictícios. Nenhuma alteração em produção.

## Evidência de conciliação necessária
O diagnóstico temporário `backend/tests/payment-reconciliation.sql` testa comparações por pedido sem somar confirmação manual, declaração do entregador e lançamento de caixa. Valores coincidentes não provam liquidação independente; sobreposição, ausência de lançamento, valor divergente e múltiplos lançamentos exigem revisão. Confirmar a fonte canônica e os gatilhos no esquema real restaurado antes de definir um escritor único de recebimentos. Não importar histórico a partir de suposições do harness.
