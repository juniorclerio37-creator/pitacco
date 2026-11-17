// Pitacco Entregador: aplicativo continua usando celular e senha.
// O Supabase Auth usa um identificador interno por e-mail para evitar SMS/Twilio.
import { normalizeBrazilPhone, courierEmailAlias } from './identity.mjs';
export { normalizeBrazilPhone } from './identity.mjs';
export function createDriverAuth(supabase) {
  if (!supabase?.auth?.signInWithPassword) throw new Error('Supabase Auth indisponível');
  return {
    async signIn(phone, password) {
      const email = await courierEmailAlias(phone);
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error('Celular ou senha inválidos. Solicite uma nova senha à loja se o cadastro for anterior à atualização.');
      if (!data?.user) throw new Error('Sessão não disponível');
      return data;
    },
    async signOut() {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    async currentUser() {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      return data?.user ?? null;
    },
    async myCourierRecords() {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) throw new Error('Acesso não autenticado');
      const { data, error } = await supabase.from('couriers')
        .select('id,store_id,name,phone,active,available')
        .eq('user_id', userData.user.id).eq('active', true);
      if (error) throw error;
      return data ?? [];
    },
    async myDeliveries(courierIds) {
      if (!Array.isArray(courierIds) || !courierIds.length) return [];
      // RLS MUST enforce ownership. Client-side filters alone are insufficient.
      const { data, error } = await supabase.from('deliveries')
        .select('id,store_id,order_id,courier_id,customer_name,address,notes,delivery_fee,courier_payment,status,source,logistics_provider,batch_id,requires_delivery_code,delivery_code_verified_at,collected_at,created_at')
        .in('courier_id', courierIds);
      if (error) throw error;
      return data ?? [];
    },
  };
}
