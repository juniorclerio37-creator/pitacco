// Reference model for test cases only; actual authorization is enforced by Supabase RLS.
export function canReadDelivery({ isPlatformAdmin, memberships, viewerUserId, couriers, delivery }) {
  if (isPlatformAdmin) return true;
  const manager = memberships.some(m =>
    m.user_id === viewerUserId &&
    m.store_id === delivery.store_id &&
    ['gestor', 'lojista'].includes(m.role)
  );
  if (manager) return true;
  return couriers.some(c =>
    c.id === delivery.courier_id &&
    c.store_id === delivery.store_id &&
    c.user_id === viewerUserId &&
    c.active === true
  );
}
