# Confirmação de entrega por código — Pitacco Entregador

## Regra obrigatória
Para pedidos de **entrega própria** originados em iFood, 99Food e Keeta, o aplicativo deve solicitar o código de entrega no encerramento sempre que a integração oficial da plataforma exigir ou disponibilizar essa confirmação. O código precisa ser validado pelo marketplace via integração oficial quando houver endpoint autorizado; **não basta comparar localmente**.

## Fluxo
1. Pedido marketplace é recebido com número original e informação de modalidade logística.
2. Se for entrega parceira da plataforma, não alocar entregador Pitacco; manter fluxo do marketplace.
3. Se for entrega própria, alocar ao entregador da loja e seguir estados de coleta/rota.
4. Ao finalizar, apresentar modal de código com identificação da plataforma, campo numérico/textual conforme regra documentada e botão Confirmar.
5. Enviar ao backend autenticado, com idempotency key, o identificador do pedido e o código. O backend identifica a plataforma, verifica vínculo de loja/entregador e consulta a integração autorizada.
6. Confirmado pela plataforma: persistir resposta, evento de auditoria, marcar entregue e sincronizar lojista/entregador.
7. Código inválido, API indisponível, timeout ou resposta inconclusiva: **não marcar como entregue**; permitir nova tentativa segura e orientar suporte/fluxo oficial.
8. Não registrar código em logs, analytics, notificações ou histórico legível; mascarar entrada, aplicar limites de tentativa conforme política oficial.

## Pedidos próprios
Aplicar PIN Pitacco ou foto, segundo configuração da loja. O PIN Pitacco é gerado e validado no backend, nunca hardcoded no aplicativo.

## Compatibilidade
As regras e endpoints de confirmação podem variar por marketplace, versão de API e homologação. Não assumir que as três plataformas possuem exatamente o mesmo endpoint, formato de PIN ou política de finalização. Criar adapters separados `ifood`, `99food`, `keeta` com capacidades negociadas por integração e testes reais de homologação.

## Testes mínimos
- Código correto confirmado pelo marketplace -> entregue.
- Código errado -> permanece em andamento.
- Timeout e reconexão -> sem duplicação e sem conclusão falsa.
- Entrega parceira -> sem tela de PIN Pitacco.
- Pedido próprio -> PIN Pitacco ou foto, conforme configuração.
- Outro entregador ou loja não consegue confirmar.

## Estado atual
A demonstração em `entregador/index.html` usa código **fictício 1234** para testar a interação, sem integração com iFood, 99Food ou Keeta. Isso não representa confirmação real da plataforma.
