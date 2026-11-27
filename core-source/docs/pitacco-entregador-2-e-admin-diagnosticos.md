# Pitacco Entregador 2.0 e Central de Diagnósticos exclusiva do Super Admin

## Decisões do proprietário

- **Não recriar o Pitacco:** preservar backend compartilhado, contas, sessões, lojas, dados, pedidos, entregas e configurações.
- **Entregador:** manter exatamente as quatro abas Pedidos, Ganhos, Perfil, Ajustes, e a identidade laranja existente.
- **Central técnica:** acessível apenas ao Super Admin. Loja continua vendo **avisos operacionais** necessários para agir, sem diagnóstico técnico interno, e o entregador não recebe ferramentas de suporte/diagnóstico.
- **Alertas do proprietário:** incidentes críticos da operação devem chegar assim que forem identificáveis; nenhuma automação deve confirmar pagamento, entrega ou impressão por conta própria.
- **Distribuição Android:** preservar Firebase existente. Caso o APK novo não utilize o mesmo certificado, testar migração em um aparelho, sem desinstalar previamente a versão operacional. Assinatura de distribuição deve ser mantida em segredo permanentemente.

## Escopo da versão 2.0 — sete frentes

| Frente | Reaproveitar | Aceite e homologação exigidos |
| --- | --- | --- |
| Avisos nativos | Firebase, token por entregador e canal Android de alta importância | Atribuição dispara aviso ao vivo com app aberto, minimizado e com tela bloqueada; conferir som forte, vibração, duplicidade e respeito às permissões; após fechamento forçado não há garantia Android |
| Google Maps/Waze | `navigation.mjs` e abertura de links pelo WebView | Botões abrem destino certo; endereço incompleto usa fallback; roteamento não cria contramão automática |
| GPS e chegada | `pitacco_driver_arrive`, localização autorizada e integração iFood | Registrar `Cheguei na entrega` com horário verificável; enviar ao marketplace **apenas se API permitir**, sem inventar confirmação |
| Conclusão segura | Validação de código do marketplace e PIN/foto no cardápio próprio | Sem conclusão duplicada nem bypass de PIN oficial; estados preparado/pronto **não** concluem pedido no marketplace |
| Ganhos e acertos | Painel de ganhos e histórico dos pagamentos da loja | Dias/semanas/meses consistentes, separação das lojas e indicação de recebido/pendente |
| Queda de conexão | Tela offline existente + aviso web adicionado | Entregas carregadas permanecem visíveis enquanto a tela existe, novas ações exigem resposta do servidor; reconectar e consultar estado real; **não** gravar dados pessoais de clientes em armazenamento web sem proteção |
| Múltiplas lojas | Uma sessão e lista de lojas explicitamente autorizadas | Mostrar origem de cada pedido, preservar RLS, sem misturar acertos, permitir exceções somente com autorização expressa |

## Super Admin: Central de Diagnósticos

A arquitetura mantém o monitor existente `pitacco_operational_incidents` e o acesso exclusivo do proprietário às RPCs de diagnóstico. O Super Admin terá:

- Contagem de incidentes abertos/não reconhecidos e destaque de urgência.
- Falhas operacionais de impressão, marketplace, entrega parceira e pagamento registradas no banco **no momento da falha**, além de atrasos detectados na varredura periódica.
- Consulta de todas as lojas, filtragem, histórico e reconhecimento auditável sem encerrar falha que ainda persiste.
- Avisos sonoros e notificações do navegador **enquanto a sessão administrativa estiver aberta**, após permissão explícita, sem exibir dados de clientes.
- Monitoramento estendido progressivo para status do Windows/impressoras, disponibilidade do Firebase, webhooks, autenticação, pedidos e rotas. Não declarar áreas ainda sem sondas como verificadas.

**Limite importante:** notificação quando o navegador Admin está completamente fechado depende de um canal externo/autenticado de push, e-mail ou dispositivo administrador. Não há garantia de alarme fora do navegador até homologar esse canal, seus segredos e testes ponta a ponta.

## Regras técnicas de implantação

1. Não alterar versões de entrega em andamento nem remover o aplicativo atual antes de validar 2.0 com assinatura autorizada.
2. Não rodar ações de entrega em segundo plano sem autenticação, autorização, GPS e validação aplicável.
3. Não persistir PINs de marketplaces em notificações, logs ou cache do dispositivo.
4. Não publicar APK como estável só porque compilou; validar a assinatura oficial, instalação/atualização e Firebase.
5. Anotar claramente cada melhoria como: código preparado, testes automatizados aprovados, implantação feita, teste real no aparelho aprovado.

## Checklist final de homologação

- Pedido próprio → aceite → entregador → coleta → saída → chegada → PIN/foto → entregue.
- iFood/99Food/Keeta → prova oficial de entrega, estados intermediários corretos, eventos idempotentes.
- Entregador único autorizado em duas lojas, separação de saldos e lojas.
- App aberto/minimizado/bloqueado, notificação forte e sem duplicações, fluxo quando volta do offline.
- Testes com internet intermitente, GPS sem permissão, login expirado e app atualizado.
- Incidentes do Admin disparados e reconhecidos sem alterar o estado dos pedidos.
