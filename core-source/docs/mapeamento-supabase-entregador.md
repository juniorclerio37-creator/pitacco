# Mapeamento do banco real do Pitacco para o Entregador
Inspeção realizada em 2026-11-17 no projeto Supabase `mdevzehqcpcgxspwbiyz`. Este documento é mapeamento, não migração aplicada.

## Estruturas existentes confirmadas
- `public.couriers`: `id`, `user_id`, `name`, `phone`, `store_id`, `active`, `available`, `fleet_type`.
- `public.store_members`: `store_id`, `user_id`, `role`.
- `public.profiles`: `id`, `email`, `full_name`, `role` (inclui `entregador`).
- `public.pitacco_courier_invites`: `store_id`, `email`, `name`, `phone`, `claimed_at`, `claimed_by`.
- `public.deliveries`: `id`, `store_id`, `order_id`, `courier_id`, `status`, `source`, `requires_delivery_code`, `delivery_code_verified_at`, `collected_at`, `logistics_provider`, `external_order_id`, `delivery_fee`, `courier_payment`.
- `public.orders`: `id`, `store_id`, `channel`, `gross`, `status`, `receipt` (JSONB), `source`.

## Integração pretendida
- Usar `couriers` como cadastro operacional; o gestor cria e vincula entregador.
- Usar `couriers.user_id` para relacionar identidade do Supabase Auth, sem criar tabela concorrente de entregadores.
- Usar `deliveries.courier_id` para listar entregas atribuídas e acompanhar transições. Nenhuma etapa de aceite/recusa.
- Reutilizar `requires_delivery_code` e `delivery_code_verified_at` como marcadores, mas **não** marcar confirmação antes da resposta autorizada da plataforma.
- Não assumir que `orders.gross` é o total a cobrar; confirmar o contrato de `orders.receipt` e dados financeiros oficiais de cada marketplace antes de exibir valor ou troco.

## Pendências antes de mudanças em produção
1. Inspecionar policies RLS, constraints e funções atuais; não sobrescrever políticas existentes.
2. Confirmar a configuração de telefone+senha do Supabase Auth e se números estão verificados; implementar onboarding administrado pela loja sem signup público.
3. Definir como armazenar `must_change_password` em tabela de segurança protegida ou claims controladas pelo servidor, sem confiar em metadata editável pelo usuário.
4. Implementar reset com credencial temporária individual e revogação de sessões; evitar senha universal `1234`.
5. Definir tratamento de entregador vinculado a múltiplas lojas e autorização para reset.
6. Implementar transições de entrega por endpoint autenticado, com versão e idempotência; realocação atômica no backend.
7. Integrar UI, testar e só então publicar.

## Verificação
Apenas inspeção de esquema foi executada. Nenhuma tabela, usuário, política ou dado de produção foi alterado.
