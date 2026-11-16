const adminOrigin = 'https://admin.pitacco.com.br';
const usernamePattern = /^[0-9]{11}$/;

export function createPlatformOwnerLogin({ supabaseUrl, publicKey, serviceKey, additionalOrigin, fetcher = fetch }) {
  return async request => {
    const origin = request.headers.get('origin');
    const headers = { 'cache-control': 'no-store', vary: 'Origin' };
    const reply = status => new Response(null, { status, headers });
    if (!origin || (origin !== adminOrigin && origin !== additionalOrigin)) return reply(403);
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-headers'] = 'apikey, content-type';
    headers['access-control-allow-methods'] = 'POST, OPTIONS';
    if (request.method === 'OPTIONS') return reply(204);
    if (request.method !== 'POST') return reply(405);
    if (!supabaseUrl || !publicKey || !serviceKey) return reply(503);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return reply(400);
    if (Number(request.headers.get('content-length')) > 4096) return reply(413);

    try {
      const { username, password } = (await request.json()) ?? {};
      if (typeof username !== 'string' || !usernamePattern.test(username) ||
          typeof password !== 'string' || !password.length || password.length > 256) return reply(401);

      const signal = AbortSignal.timeout(8000);
      const usernameHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(username))),
        byte => byte.toString(16).padStart(2, '0')).join('');
      const lookup = await fetcher(new URL('/rest/v1/rpc/pitacco_lookup_platform_owner_login', supabaseUrl), {
        method: 'POST', signal, redirect: 'error',
        headers: { apikey: serviceKey, authorization: 'Bearer ' + serviceKey, 'content-type': 'application/json' },
        body: JSON.stringify({ p_username_hash: usernameHash })
      });
      if (!lookup.ok) return reply(503);
      const ownerEmail = await lookup.json();
      if (typeof ownerEmail !== 'string' || !ownerEmail) return reply(401);

      const authResponse = await fetcher(new URL('/auth/v1/token?grant_type=password', supabaseUrl), {
        method: 'POST', signal, redirect: 'error',
        headers: { apikey: publicKey, 'content-type': 'application/json' },
        body: JSON.stringify({ email: ownerEmail, password })
      });
      if (authResponse.status === 429) return reply(429);
      if ([400, 401, 403, 422].includes(authResponse.status)) return reply(401);
      if (!authResponse.ok) return reply(503);
      const { access_token, refresh_token } = await authResponse.json();
      if (typeof access_token !== 'string' || !access_token || typeof refresh_token !== 'string' || !refresh_token) return reply(503);

      const ownerResponse = await fetcher(new URL('/rest/v1/rpc/pitacco_is_platform_owner', supabaseUrl), {
        method: 'POST', signal, redirect: 'error',
        headers: { apikey: publicKey, authorization: 'Bearer ' + access_token, 'content-type': 'application/json' },
        body: '{}'
      });
      if (!ownerResponse.ok) return reply(503);
      if (await ownerResponse.json() !== true) return reply(401);
      return Response.json({ access_token, refresh_token }, { headers });
    } catch {
      return reply(503);
    }
  };
}
