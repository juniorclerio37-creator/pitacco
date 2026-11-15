const idPattern = /^pay_[A-Za-z0-9_-]{1,100}$/;
const storePattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const origins = ['https://admin.pitacco.com.br', 'https://app.pitacco.com.br', 'https://pitacco.com.br', 'https://www.pitacco.com.br'];

export function createAsaasHomologation({ supabaseUrl, publicKey, sandboxKey, additionalOrigin, fetcher = fetch }) {
  return async request => {
    const origin = request.headers.get('origin');
    const headers = { 'cache-control': 'no-store', vary: 'Origin' };
    const allowedOrigin = origin && (origins.includes(origin) || origin === additionalOrigin);
    if (allowedOrigin) {
      headers['access-control-allow-origin'] = origin;
      headers['access-control-allow-headers'] = 'authorization, apikey, content-type, x-client-info, x-supabase-api-version';
      headers['access-control-allow-methods'] = 'POST, OPTIONS';
    }
    const reply = (status, body) => Response.json(body, { status, headers });
    if (origin && !allowedOrigin) return reply(403, { error: 'Origem indisponível' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405, { error: 'Método indisponível' });

    const authorization = request.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) return reply(401, { error: 'Entre no Pitacco Admin' });

    let input;
    try {
      input = await request.json();
    } catch {
      return reply(400, { error: 'Dados inválidos' });
    }
    const { store_id: store, payment_id: paymentId } = input || {};
    if (typeof store !== 'string' || !storePattern.test(store) ||
        typeof paymentId !== 'string' || !idPattern.test(paymentId)) {
      return reply(400, { error: 'Informe a loja e o ID da cobrança de teste' });
    }

    const signal = AbortSignal.timeout(8000);
    const probe = (payload) => fetcher(new URL('/rest/v1/rpc/pitacco_admin_homologation_probe', supabaseUrl), {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', apikey: publicKey, authorization },
      body: JSON.stringify({ p_store: store, ...payload })
    });

    try {
      const access = await probe({});
      if (!access.ok) return reply(access.status >= 500 ? 503 : 403, { error: 'Consulta reservada à administração do Pitacco' });
      if (!sandboxKey) return reply(200, { outcome: 'sandbox_key_missing' });

      const charge = await fetcher(new URL('/v3/payments/' + encodeURIComponent(paymentId), 'https://api-sandbox.asaas.com'), {
        headers: { accept: 'application/json', access_token: sandboxKey, 'user-agent': 'Pitacco/1.0' }, signal,
        redirect: 'error'
      });
      if (charge.status === 404) return reply(200, { outcome: 'not_found' });
      if (!charge.ok) return reply(200, { outcome: 'provider_unavailable' });

      const payment = await charge.json();
      if (payment.id !== paymentId) return reply(502, { error: 'Retorno da cobrança incompatível' });
      const verification = await probe({ p_subscription: payment.subscription || null, p_payment: paymentId });
      if (!verification.ok) return reply(503, { error: 'Não foi possível conferir o vínculo no Pitacco' });
      const information = await verification.json();
      return reply(200, {
        outcome: 'checked',
        confirmed: ['RECEIVED', 'CONFIRMED'].includes(payment.status),
        plan_amount: payment.value === 59.90,
        sandbox_enabled: information.asaas_environment === 'sandbox',
        linked: information.sandbox_payment_linked === true,
        recorded: information.sandbox_payment_recorded === true
      });
    } catch {
      return reply(503, { error: 'Não foi possível consultar o ambiente de testes' });
    }
  };
}
