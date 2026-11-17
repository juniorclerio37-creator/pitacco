// Pitacco Entregador: aplicativo continua usando celular e senha.
// O Supabase Auth usa um identificador interno por e-mail para evitar SMS/Twilio.
import { normalizeBrazilPhone, courierEmailAlias } from './identity.mjs';
export { normalizeBrazilPhone } from './identity.mjs';
export function isMissingSessionError(error) {
  const code = String(error?.code ?? '').toLowerCase();
  const name = String(error?.name ?? '').toLowerCase();
  const message = String(error?.message ?? error ?? '').toLowerCase();
  return code === 'session_not_found' || code === 'session_missing' ||
    name === 'authsessionmissingerror' ||
    message.includes('auth session missing') ||
    message.includes('session not found');
}

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
      // A troca administrativa de senha pode invalidar o JWT antes do logout.
      // Limpa a sessão local sem transformar "session missing" em erro visível.
      try {
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error && !isMissingSessionError(error)) throw error;
      } catch (error) {
        if (!isMissingSessionError(error)) throw error;
      }
    },
    async currentUser() {
      // Em uma primeira visita, não há sessão: isso é estado normal, não falha.
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          if (isMissingSessionError(sessionError)) return null;
          throw sessionError;
        }
        if (!sessionData?.session?.access_token) return null;
        const { data, error } = await supabase.auth.getUser();
        if (error) {
          if (isMissingSessionError(error)) return null;
          throw error;
        }
        return data?.user ?? null;
      } catch (error) {
        if (isMissingSessionError(error)) return null;
        throw error;
      }
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
