# Entrega Pitacco 0.12 — 9 de novembro de 2026

Instalador gerado em Windows: **Pitacco_0.12.0_x64-setup.exe**, 5.607.625 bytes.
SHA-256: `ad944af01438251753b71095811903d333df9889c90cb718a082d4d8f668f2af`.
Fonte compilada: [fdf3be95](https://github.com/juniorclerio37-creator/pitacco/commit/fdf3be95ccc9b1a4b35be495bae75af013f4e395).
[Execução Windows e PostgreSQL aprovada](https://github.com/juniorclerio37-creator/pitacco/actions/runs/42679887733).
[Análise Flutter aprovada](https://github.com/juniorclerio37-creator/pitacco/actions/runs/42679992095).

## Atualização
Após backup, execute **uma vez** [setup/ATUALIZAR-PITACCO-0.12.sql](setup/ATUALIZAR-PITACCO-0.12.sql) no SQL Editor do projeto existente com a base até 011. Encerre o aplicativo pela bandeja e instale o novo executável. Não reinstale o schema inicial nem crie outro projeto Supabase.

## Implementado
- Quadro de pedidos com preparo e logística separados, origem, pagamento informado e entregador.
- Modal Entrega e entregador no próprio pedido, atribuição manual, confirmação de possível desvio e auditoria.
- Bloqueio de nova atribuição para entrega da plataforma e proteção contra duplicidade.
- Cadastro de entregadores separado; configuração em Minha Loja → Entregas.
- Cozinha e expedição com os mesmos estados confirmados do quadro.
- Coleta individual, saída que fecha a rota e conclusão por pedido. Uma parada restante mantém o entregador ocupado.
- GPS autenticado no código Flutter e serviço de alocação por vias dirigidas, capacidade e prazos. O serviço precisa ser implantado/configurado; não foi ativado no banco do restaurante.
- Migração incremental e testes transacionais, incluindo concorrência real.

## Preservado
Nenhum arquivo anterior removido; 79 arquivos idênticos ao pacote 0.11.1. Núcleo Rust de impressão e SQLite idênticos byte a byte. Mantidos backend de checkout/pagamentos manuais, produtos, despesas, administração, assinaturas administrativas, importação, web e código Android. O aplicativo usa o identificador anterior para manter os dados locais.

## Testado
27 testes JavaScript, 6 testes Rust, migrações e cenários SQL em PGlite e PostgreSQL 16, corrida simultânea com duas conexões, regressão de checkout/preparo após a migração e navegação React automatizada no Chrome do Windows com API simulada. Instalador NSIS compilado com sucesso. Flutter sem erros de análise; um aviso informativo sobre `anonKey` depreciado permanece. Não foi compilado um APK novo.

## Limitações verificadas
Não testados impressora física 80 mm, notificações no computador do restaurante, GPS em aparelho ou ciclo real até entrega. Entregas sob demanda e marketplaces ainda dependem de implementação/credenciais/homologação oficiais; não há cotações ou contratação fictícias. Alocação automática exige worker, serviço de rotas, coordenadas/prazos e GPS recente. Não há geocodificação automática ou GPS garantido em segundo plano. CRM completo, relatórios avançados, ocorrências/comprovação própria e checkout público visual continuam pendentes. Atualizações assinadas requerem chave e endpoint; instalador de testes sem certificado comercial.

[Guia completo e implantação](revisions/0.12/docs/ATUALIZACAO-0.12.md).
[Código incremental legível](revisions/0.12). O código completo reconstruído também está no artefato **Pitacco-Codigo-Completo** da execução aprovada; `source/` e `updates/0.11.1/` foram preservados.
