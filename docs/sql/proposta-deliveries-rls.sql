-- PROPOSTA PARA REVISÃO — NÃO EXECUTADA EM PRODUÇÃO
-- Escopo: substituir somente a política SELECT de public.deliveries.
-- Antes de aplicar, verificar valores reais de store_members.role e o modelo de
-- administração da loja, pois uma policy errada pode bloquear gestores.
BEGIN;
DROP POLICY IF EXISTS delivery_select ON public.deliveries;
CREATE POLICY delivery_select ON public.deliveries
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.store_members sm
      WHERE sm.store_id = deliveries.store_id
        AND sm.user_id = (SELECT auth.uid())
        AND sm.role IN ('gestor', 'lojista')
    )
    OR (
      deliveries.courier_id IS NOT NULL
      AND public.is_courier(deliveries.courier_id)
    )
  );
COMMIT;
-- O banco atual já possui RLS em public.deliveries.
-- Não aplicar sem verificar grants, testes com usuários distintos,
-- acesso do painel administrativo e implicações de outras policies.
