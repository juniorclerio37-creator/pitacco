import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlatformOwnerLogin } from '../supabase/functions/platform-owner-login/handler.mjs';

const config = {
  supabaseUrl: 'https://db.example.invalid',
  publicKey: 'public-fixture',
  ownerUsername: '00000000001',
  ownerEmail: 'owner@example.invalid'
};
const password = 'fixture-only';
function request({ origin = 'https://admin.pitacco.com.br', username = config.ownerUsername, secret = password } = {}) {
  return new Request('https://db.example.invalid/functions/v1/platform-owner-login', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: secret })
  });
}

test('accepts the configured username and releases tokens after the database verifies the owner', async () => {
  const calls = [];
  const tokens = { access_token: 'fixture-access', refresh_token: 'fixture-refresh' };
  const login = createPlatformOwnerLogin({ ...config, fetcher: async (url, options) => {
    calls.push([url.pathname + url.search, options]);
    return Response.json(calls.length === 1 ? { ...tokens, email: config.ownerEmail } : true);
  } });
  const response = await login(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), tokens);
  assert.equal(calls[0][0], '/auth/v1/token?grant_type=password');
  assert.deepEqual(JSON.parse(calls[0][1].body), { email: config.ownerEmail, password });
  assert.equal(calls[1][0], '/rest/v1/rpc/pitacco_is_platform_owner');
  assert.equal(calls[1][1].headers.authorization, 'Bearer fixture-access');
});

test('blocks merchant origins and other usernames before calling Supabase', async () => {
  const login = createPlatformOwnerLogin({ ...config, fetcher: () => assert.fail('Unexpected auth call') });
  assert.equal((await login(request({ origin: 'https://app.pitacco.com.br' }))).status, 403);
  assert.equal((await login(request({ username: '00000000002' }))).status, 401);
  assert.equal((await login(request({ secret: '' }))).status, 401);
});

test('withholds tokens if the owner relationship is missing or the check is unavailable', async () => {
  for (const [ownerResponse, expected] of [[Response.json(false), 401], [new Response(null, { status: 404 }), 503]]) {
    let checked = false;
    const login = createPlatformOwnerLogin({ ...config, fetcher: async url => {
      if (url.pathname === '/auth/v1/token') return Response.json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh' });
      checked = true;
      return ownerResponse;
    } });
    const response = await login(request());
    assert.equal(checked, true);
    assert.equal(response.status, expected);
    assert.equal(await response.text(), '');
  }
});

test('preserves Auth throttling and hides provider authentication errors', async () => {
  for (const [status, expected] of [[400, 401], [429, 429]]) {
    const login = createPlatformOwnerLogin({ ...config, fetcher: async () => Response.json({ detail: 'Private upstream error' }, { status }) });
    const response = await login(request());
    assert.equal(response.status, expected);
    assert.equal(await response.text(), '');
  }
});
