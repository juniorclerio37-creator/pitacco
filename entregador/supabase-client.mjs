// Pitacco Entregador: authenticated client integration.
// Requires an initialized Supabase client passed by the application.
// Does not create users or permit public signup.
export function normalizeBrazilPhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  const national = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (!/^[1-9][0-9]9[0-9]{8}$/.test(national)) throw new Error('Informe celular com DDD válido');
  return '+55' + national;
}
export function createDriverAuth(supabase) {
  if (!supabase?.auth?.signInWithPassword) throw new Error('Supabase Auth indisponível');
  return {
    async signIn(phone, password) {
      const normalized = normalizeBrazilPhone(phone);
      const { data, error } = await supabase.auth.signInWithPassword({ phone: normalized, password });
      if (error?.code === 'phone_provider_disabled') throw new Error('Login por telefone está desativado no Supabase. Solicite ao administrador que habilite Authentication → Providers → Phone. Sua senha não foi verificada.');
      if (error) throw new Error('Telefone ou senha inválidos');
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
