const environments = {
  sandbox: 'https://api-sandbox.asaas.com',
  production: 'https://api.asaas.com'
};
const confirmationEvents = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);
const incidentEvents = new Set(['PAYMENT_REFUNDED','PAYMENT_PARTIALLY_REFUNDED','PAYMENT_REFUND_IN_PROGRESS','PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_CHARGEBACK_DISPUTE','PAYMENT_AWAITING_CHARGEBACK_REVERSAL','PAYMENT_DELETED']);
const confirmedStatuses = new Set(['CONFIRMED', 'RECEIVED']);
const paymentId = /^pay_[A-Za-z0-9_-]{1,100}$/;
const subscriptionId = /^sub_[A-Za-z0-9_-]{1,100}$/;
const encoder = new TextEncoder();

function reply(status, outcome) {
  return Response.json({ outcome }, { status });
}

async function sameToken(candidate, approved) {
  const digests = await Promise.all([candidate, approved].map(value =>
    crypto.subtle.digest('SHA-256', encoder.encode(value))
  ));
  const given = new Uint8Array(digests[0]);
  const expected = new Uint8Array(digests[1]);
  let differences = 0;
  for (let i = 0; i < expected.length; i++) differences |= given[i] ^ expected[i];
  return differences === 0;
}

async function readMessage(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing body');
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 128 * 1024) {
        await reader.cancel();
        throw new RangeError('Body too large');
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

export function createAsaasWebhook({ environment, token, apiKey, supabaseUrl, serviceKey, fetcher = fetch }) {
  const apiOrigin = Object.hasOwn(environments, environment) ? environments[environment] : null;
  const configured = apiOrigin && /^\S{32,255}$/.test(token || '') && apiKey && token !== apiKey &&
    /^https:\/\/[^\s/]+\/?$/.test(supabaseUrl || '') && serviceKey;

  return async request => {
    if (request.method !== 'POST') return reply(405, 'method_not_allowed');
    if (!configured) return reply(503, 'configuration_unavailable');
    const provided = request.headers.get('asaas-access-token');
    if (!provided || provided.length > 255 || !await sameToken(provided, token)) {
      return reply(401, 'unauthorized');
    }

    let message;
    try {
      message = await readMessage(request);
    } catch (error) {
      return error instanceof RangeError ? reply(413, 'payload_too_large') : reply(400, 'invalid_json');
    }
    const incident=incidentEvents.has(message?.event);
    if (!confirmationEvents.has(message?.event) && !incident) return reply(200, 'ignored_event');
    const id = message?.payment?.id;
    if (typeof id !== 'string' || !paymentId.test(id)) return reply(400, 'invalid_payment');

    const signal = AbortSignal.timeout(8000);
    try {
      const verification = await fetcher(new URL('/v3/payments/' + encodeURIComponent(id), apiOrigin), {
        headers: { accept: 'application/json', access_token: apiKey, 'user-agent': 'Pitacco/1.0' },
        signal
      });
      if (!verification.ok) return reply(503, 'provider_verification_unavailable');
      const payment = await verification.json();
      const ref=typeof payment.externalReference==='string'&&payment.externalReference.match(/^pitacco:invoice:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
      if(incident){
        if(!ref||environment!=='production')return reply(200,'ignored_event');
        if(payment.id!==id||typeof payment.customer!=='string'||!/^cus_[A-Za-z0-9_-]{1,100}$/.test(payment.customer)||typeof payment.status!=='string'||payment.status.length>80)return reply(503,'incident_verification_unavailable');
        const headers={'content-type':'application/json',apikey:serviceKey};
        if(serviceKey.startsWith('eyJ'))headers.authorization='Bearer '+serviceKey;
        const sync=await fetcher(new URL('/rest/v1/rpc/pitacco_asaas_record_commercial_incident',supabaseUrl),{method:'POST',headers,body:JSON.stringify({p_invoice:ref[1],p_payment:id,p_customer:payment.customer,p_event:message.event,p_status:payment.status}),signal});
        if(!sync.ok)return reply(503,'incident_sync_unavailable');
        const outcome=await sync.json();
        return outcome==='review_required'?reply(200,'incident_recorded'):reply(503,'commercial_reconciliation_required');
      }
      if(ref){
        if(environment!=='production'||payment.id!==id||!confirmedStatuses.has(payment.status)||typeof payment.customer!=='string'||!/^cus_[A-Za-z0-9_-]{1,100}$/.test(payment.customer)||typeof payment.value!=='number'||!Number.isSafeInteger(Math.round(payment.value*100))||payment.value<=0||Math.abs(payment.value*100-Math.round(payment.value*100))>0.000001)return reply(200,'payment_not_eligible');
        const headers={'content-type':'application/json',apikey:serviceKey};
        if(serviceKey.startsWith('eyJ'))headers.authorization='Bearer '+serviceKey;
        const sync=await fetcher(new URL('/rest/v1/rpc/pitacco_asaas_settle_commercial_invoice',supabaseUrl),{method:'POST',headers,body:JSON.stringify({p_payment_id:id,p_customer_id:payment.customer,p_invoice:ref[1],p_amount_cents:Math.round(payment.value*100)}),signal});
        if(!sync.ok)return reply(503,'commercial_sync_unavailable');
        const outcome=await sync.json();
        if(outcome==='processed'||outcome==='duplicate')return reply(200,outcome);
        return reply(503,'commercial_reconciliation_required');
      }
      if (payment.id !== id || !confirmedStatuses.has(payment.status) ||
          typeof payment.subscription !== 'string' || !subscriptionId.test(payment.subscription) ||
          typeof payment.value !== 'number' || payment.value !== 59.90) {
        return reply(200, 'payment_not_eligible');
      }

      const headers = { 'content-type': 'application/json', apikey: serviceKey };
      if (serviceKey.startsWith('eyJ')) headers.authorization = 'Bearer ' + serviceKey;
      const sync = await fetcher(new URL('/rest/v1/rpc/pitacco_record_asaas_subscription_payment', supabaseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          p_environment: environment, p_subscription_id: payment.subscription,
          p_payment_id: payment.id, p_amount: payment.value
        }),
        signal
      });
      if (!sync.ok) return reply(503, 'subscription_sync_unavailable');
      const paidUntil = await sync.json();
      return reply(200, paidUntil ? 'processed' : 'subscription_not_linked');
    } catch {
      return reply(503, 'verification_unavailable');
    }
  };
}
