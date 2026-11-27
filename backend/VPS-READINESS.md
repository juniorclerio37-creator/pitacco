# Pitacco Core — critérios para contratar o VPS

Estado: **não contratar nesta etapa**. Branch experimental pitacco-core; não constitui autorização de publicação ou compra.

## Antes de contratar um servidor de homologação
- [ ] Cinco suítes Core aprovadas no mesmo commit, incluindo regressão logística de reconciliação oficial, cotação e roteamento de impressão.
- [ ] Inventário de dependências reais (Supabase Auth/Postgres/RLS/RPC/storage/realtime/Edge Functions, Cloudflare, Firebase, gateways e integrações).
- [ ] Plano reproduzível para Laravel/PHP, PostgreSQL, Redis, Reverb, workers, agendador, armazenamento e TLS.
- [ ] Estratégia para backup/restauração testável, segregação de ambientes, segredos, métricas, logs e rollback.
- [ ] Estimativa de CPU, RAM e disco baseada em carga de teste; comparação de fornecedores, localização e preço com aprovação do responsável.
- [ ] Identificar o que será testado no VPS sem acessar produção ou alterar webhooks homologados.

## Antes de migrar produção
- [ ] Aplicativo Windows e navegador equivalentes à versão atual: mesma interface, fila, modelo de cupom, logo, QR, origens, setores, cópias e impressoras reais 58/80 mm; testar falhas e duplicação.
- [ ] Android: interface e modais originais, maquininha, troco, coleta, saída, mapa, GPS em segundo plano, notificações, cobrança, código, saldo, rotas e navegação; teste em aparelho real.
- [ ] Cardápio e checkout equivalentes, inclusive cadastro persistente, carteira, Fiado, formas de pagamento, agendamento e acompanhamento.
- [ ] Control Center, planos, cobranças, bloqueios, permissões e isolamento entre lojas.
- [ ] Order e Events iFood preservados e validados com seus fluxos oficiais; confirmar com iFood eventual exigência de nova homologação em mudança de infraestrutura. Shipping separado e desativado comercialmente até homologação específica; 99Food e Keeta conforme disponibilidade das respectivas integrações.
- [ ] Ensaiar exportação/importação dos dados e arquivos, reconciliação de totais e pedidos, migração incremental, janela de corte e rollback sem perder pedidos.
- [ ] Auditoria de segurança e desempenho, teste de restauração e autorização explícita antes do corte.

O VPS de homologação pode ser necessário antes da validação física e de carga; não confundir servidor de testes com autorização para desligar Supabase ou migrar produção. Não armazenar credenciais neste documento.
