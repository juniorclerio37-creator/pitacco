const bucket = 'pitacco-installers';
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const maxSize = 50 * 1024 * 1024;

export function installerFormat(bytes, filename) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (filename.endsWith('.exe')) {
    if (bytes.length < 64 || view.getUint16(0, true) !== 0x5a4d) return false;
    const header = view.getUint32(60, true);
    return header >= 64 && header <= bytes.length - 24 && view.getUint32(header, true) === 0x4550;
  }
  if (filename.endsWith('.msi')) {
    const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    return bytes.length >= 512 && magic.every((value, i) => bytes[i] === value);
  }
  if (!filename.endsWith('.apk') || bytes.length < 22 || view.getUint32(0, true) !== 0x04034b50) return false;
  // APKs are ZIPs with a root AndroidManifest.xml. Inspect their directory without expanding entries.
  for (let end = bytes.length - 22; end >= Math.max(0, bytes.length - 65557); end--) {
    if (view.getUint32(end, true) !== 0x06054b50 || end + 22 + view.getUint16(end + 20, true) !== bytes.length) continue;
    const start = view.getUint32(end + 16, true);
    const size = view.getUint32(end + 12, true);
    if (start + size > end) return false;
    const name = 'AndroidManifest.xml';
    let offset = start;
    while (offset + 46 <= start + size && view.getUint32(offset, true) === 0x02014b50) {
      const length = view.getUint16(offset + 28, true);
      const next = offset + 46 + length + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
      if (next > start + size) return false;
      if (length === name.length && Array.from(name).every((letter, i) => bytes[offset + 46 + i] === letter.charCodeAt(0))) return true;
      offset = next;
    }
    return false;
  }
  return false;
}

async function readInstaller(response, size) {
  if (!response.ok || !response.body || !Number.isInteger(size) || size < 1 || size > maxSize) return null;
  const bytes = new Uint8Array(size);
  const reader = response.body.getReader();
  let used = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) return used === size ? bytes : null;
      if (used + value.length > size) {
        await reader.cancel();
        return null;
      }
      bytes.set(value, used);
      used += value.length;
    }
  } finally {
    reader.releaseLock();
  }
}

export function createReleaseIntegrity({url, publicKey, serviceKey, fetcher = fetch}) {
  const adminOrigin = 'https://admin.pitacco.com.br';
  function request(path, key, authorization, body) {
    return fetcher(new URL(path, url), {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: {apikey: key, authorization, 'content-type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(35000)
    });
  }
  return async function handle(req) {
    const origin = req.headers.get('origin');
    const headers = {
      'access-control-allow-origin': adminOrigin,
      'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
      'access-control-allow-methods': 'POST, OPTIONS',
      'cache-control': 'no-store'
    };
    const reply = (status, value) => Response.json(value, {status, headers});
    if (origin && origin !== adminOrigin) return reply(403, {error: 'Origem indisponível.'});
    if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers});
    if (req.method !== 'POST') return reply(405, {error: 'Operação indisponível.'});
    const authorization = req.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ') || !url || !publicKey || !serviceKey) {
      return reply(401, {error: 'Sessão administrativa indisponível.'});
    }
    try {
      const owner = await request('/rest/v1/rpc/pitacco_is_platform_owner', publicKey, authorization, {});
      if (!owner.ok || await owner.json() !== true) return reply(403, {error: 'Acesso exclusivo do proprietário.'});
      const {id} = await req.json().catch(() => ({})) ?? {};
      if (typeof id !== 'string' || !uuid.test(id)) return reply(400, {error: 'Versão inválida.'});

      const [user, release] = await Promise.all([
        request('/auth/v1/user', publicKey, authorization),
        request('/rest/v1/pitacco_app_releases?select=filename,sha256,size_bytes,state,verified_at&id=eq.' + id, publicKey, authorization)
      ]);
      if (!user.ok || !release.ok) return reply(403, {error: 'Acesso à versão indisponível.'});
      const [{id: actor}, [row]] = await Promise.all([user.json(), release.json()]);
      if (!row || row.state !== 'draft') return reply(404, {error: 'Rascunho indisponível.'});
      if (row.verified_at) return reply(200, {verified: true});

      const serviceAuth = 'Bearer ' + serviceKey;
      const file = await request('/storage/v1/object/authenticated/' + bucket + '/' + id + '/' + encodeURIComponent(row.filename), serviceKey, serviceAuth);
      const bytes = await readInstaller(file, row.size_bytes);
      if (!bytes || !installerFormat(bytes, row.filename)) {
        return reply(422, {error: 'Arquivo ausente ou formato/tamanho inválido.'});
      }
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const sha256 = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
      if (sha256 !== row.sha256) return reply(422, {error: 'O SHA-256 do arquivo difere do registrado.'});
      const saved = await request('/rest/v1/rpc/pitacco_record_release_integrity', serviceKey, serviceAuth, {
        p_id: id, p_actor: actor, p_sha256: sha256, p_size: bytes.length
      });
      if (!saved.ok || await saved.json() !== true) return reply(409, {error: 'O rascunho foi alterado. Atualize o histórico.'});
      return reply(200, {verified: true});
    } catch {
      return reply(502, {error: 'Não foi possível verificar o arquivo. Tente novamente.'});
    }
  };
}
