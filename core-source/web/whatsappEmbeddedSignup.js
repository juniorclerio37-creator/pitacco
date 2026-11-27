// Meta Embedded Signup v4 helper for Pitacco (browser HTTPS only).
// No app secret or access token is ever placed in this client module.
const META_ORIGIN = 'https://www.facebook.com';
const SDK_URL = 'https://connect.facebook.net/pt_BR/sdk.js';
let sdkPromise;

export function loadMetaSdk(appId) {
  if (!/^\d+$/.test(String(appId))) return Promise.reject(new Error('Meta app ID inválido'));
  if (typeof window === 'undefined' || window.location.protocol !== 'https:') {
    return Promise.reject(new Error('O cadastro Meta requer uma página HTTPS publicada'));
  }
  if (window.FB?.login) return Promise.resolve(window.FB);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Tempo esgotado ao carregar SDK Meta')), 15000);
    window.fbAsyncInit = () => {
      window.FB.init({ appId: String(appId), autoLogAppEvents: false, xfbml: false, version: 'v27.0' });
      window.clearTimeout(timeout);
      resolve(window.FB);
    };
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => { window.clearTimeout(timeout); sdkPromise = undefined; reject(new Error('Falha ao carregar SDK Meta')); };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

// Call only after an authenticated, store-scoped whatsapp-connect-start response.
// The caller must send the result to a server-side finalize endpoint that checks
// state/session, store authorization and code exchange. Never mark connected here.
export async function beginWhatsAppEmbeddedSignup({ appId, configId, state }) {
  if (!/^\d+$/.test(String(configId)) || !/^[a-f0-9]{64}$/.test(String(state))) {
    throw new Error('Sessão de cadastro inválida');
  }
  const FB = await loadMetaSdk(appId);
  return new Promise((resolve, reject) => {
    let authCode = null;
    let sessionInfo = null;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timeout);
      if (error) reject(error);
      else resolve({ code: authCode, wabaId: sessionInfo?.waba_id, phoneNumberId: sessionInfo?.phone_number_id, state });
    };
    const onMessage = (event) => {
      if (event.origin !== META_ORIGIN || typeof event.data !== 'string') return;
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
      if (data.event === 'FINISH' && data.data && /^\d+$/.test(String(data.data.waba_id)) &&
          /^\d+$/.test(String(data.data.phone_number_id))) {
        sessionInfo = data.data;
        if (authCode) finish();
      } else if (data.event === 'CANCEL') finish(new Error('Cadastro cancelado'));
      else if (data.event === 'ERROR') finish(new Error('A Meta não concluiu o cadastro'));
    };
    const timeout = window.setTimeout(() => finish(new Error('Tempo esgotado no cadastro WhatsApp')), 10 * 60 * 1000);
    window.addEventListener('message', onMessage);
    FB.login((response) => {
      const code = response?.authResponse?.code;
      if (!code || typeof code !== 'string') {
        finish(new Error('A Meta não retornou um código de autorização'));
        return;
      }
      authCode = code;
      if (sessionInfo) finish();
    }, {
      config_id: String(configId),
      response_type: 'code',
      override_default_response_type: true,
      extras: { version: 'v4', featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' },
      state
    });
  });
}
