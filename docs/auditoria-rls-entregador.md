# Auditoria de acesso do Pitacco Entregador — 2026-11-17

## Políticas encontradas no Supabase
`couriers`: SELECT permite `is_admin()`, `user_id = auth.uid()`, ou gerente da loja para frota própria. Não foram encontradas policies INSERT/UPDATE/DELETE nessa tabela.

`deliveries`: SELECT permite `can_access_store(store_id)` **OU** `is_courier(courier_id)`. Essa condição pode permitir que perfis de entregador com acesso à loja vejam entregas de outros entregadores, dependendo da implementação de `can_access_store`.

`store_members`: leitura por `can_access_store(store_id)`, inserção/remoção somente `is_admin()`; não assumir que o gerente possa criar vínculo sem um backend autorizado.

`pitacco_courier_invites`: nenhuma policy encontrada na inspeção de `pg_policies`; investigar grants e RLS antes de usar.

## Plano de correção
1. Inspecionar definições de `can_access_store`, `is_courier`, `is_store_manager` e `is_admin`, além dos vínculos `store_members`, antes de alterar qualquer policy.
2. Para SELECT em `deliveries`, separar acesso de gestor/admin do acesso de entregador. Gestor/admin vê entregas da loja autorizada; entregador só vê `deliveries.courier_id` correspondente a `couriers.user_id = auth.uid()` **e** `couriers.active = true`.
3. Não confiar apenas em RLS para mutações: coleta, saída, conclusão e realocação devem validar atribuição atual, loja, sessão, estado e idempotência no backend.
4. Confirmar que reset administrativo de senha não pode ser iniciado por outros entregadores ou lojistas de outra loja. Se identidade for compartilhada entre lojas, decidir modelo de reset global antes da implementação.
5. Testar com dois entregadores e duas lojas, incluindo desativação e revogação de vínculo, sem usar dados reais de clientes.

## Estado
Inspeção somente leitura, nenhuma política de produção alterada. A modificação da RLS exige verificação das funções existentes para evitar bloqueios inesperados.
