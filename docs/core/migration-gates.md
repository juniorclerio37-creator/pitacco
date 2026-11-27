# Pitacco Core — gates de migração e recuperação
## Evidência atual
- Snapshot consolidado: 388 arquivos; duas restaurações idênticas.
- CI do snapshot: compilação web, testes do painel e regressões SQL/concorrência em PostgreSQL 17 aprovados.
- Comparação de histórico: 196 de 365 correspondências de conteúdo confirmadas; 35 candidatos adicionais após normalização; 134 sem correspondência por esse método.
- Comparação de esquema no CI: 216 relações/195 isoladas (21 ausentes, 17 diferentes); 607 rotinas/544 isoladas (64 ausentes, 37 diferentes); 103 políticas/77 isoladas (28 ausentes, 2 diferentes); 81 gatilhos/71 isolados (10 ausentes).
- O executor legado usa fixtures e somente parte dos SQL históricos. Divergências não provam perda de funcionalidade em produção; elas bloqueiam a utilização desse esquema de testes como fonte de migração.
- Repositório público: não publicar dumps de produção, dados de clientes, senhas, hashes de senha, chaves, tokens ou definições inéditas contendo dados sensíveis. Artefatos públicos de CI também não são cofre.
## Estratégia
1. Mapear os objetos divergentes para SQL já versionado (workflow de recuperação).
2. Obter um dump de esquema e um backup de dados consistentes em ambiente autorizado, com ferramentas oficiais PostgreSQL. Guardar fora do GitHub, em armazenamento criptografado, com controle de acesso. Inventariar extensões, roles e grants; nunca exportar senhas de roles para o repositório.
3. Capturar metadados de Storage/Auth/Realtime, dependências e configuração das Edge Functions sem copiar credenciais ao código. Exportar objetos do Storage em backup próprio; metadados PostgreSQL não incluem os bytes das imagens. Planejar migração segura de credenciais/identidades com UUIDs preservados.
4. Restaurar em rede isolada, com jobs e webhooks externos desativados e sem credenciais reais. Testar restauração, dados, integridade referencial e segurança. Mapear as diferenças intencionais entre Supabase e Laravel em vez de copiar permissões amplas de fixtures.
5. Criar a API Laravel sobre regras SQL verificadas, com contratos explícitos, isolamento por estabelecimento, validação de entrada e transações idempotentes. Não expor RPC arbitrária, service_role ou usuário dono do banco ao navegador.
6. Homologar fluxos completos (checkout, entrega/retirada, agendamento, fiado, Fideliza+, pagamento, impressão, GPS, marketplaces e Control Center), incluindo acesso entre lojas e concorrência. Testar carga e recuperação antes de dimensionar o VPS.
7. Planejar janela de corte, congelamento de escritas ou replicação comprovada, reconciliação de pedidos, webhooks e rollback. Não executar sem aprovação da transferência de produção.
## Estado
Não houve backup integral nem restauração dos dados reais nesta fase. Nenhum SQL foi aplicado ao Supabase. A branch principal e as publicações atuais ficam fora do escopo. A construção do backend pode avançar em ambiente de testes, mas a migração de dados reais depende dos gates acima.

## Gate obrigatório: Fiado e carteira
Não autorizar a troca do backend enquanto a finalização pública de pedidos Fiado no Laravel e a interface definitiva não passarem por homologação de retirada, entrega padrão/prioritária, agendamento, aprovação manual/automática, recuperação idempotente, cancelamento, limite, vencimento e exclusão de benefícios. A consulta do extrato e a gestão administrativa aprovadas não substituem esse gate. Preservar UUIDs, saldos, sessões de dispositivo, histórico e PINs originais. A carteira precisa de titularidade real comprovada e autorização de resgates; a fixture `core_wallet_test` não é solução de produção. O usuário informou que os cadastros Fiado atuais são de teste; não usar essa informação como autorização para alterar ou excluir registros de produção. Nenhum cutover ou liberação real nesta etapa.
