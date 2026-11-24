// Candidate commercial route. Call only after token validation and successful
// GET /v3/payments/:id from the configured Asaas environment.
export async function reconcileCommercialPayment({ payment, environment, supabaseUrl, serviceKey, fetcher=fetch, signal }) {
  const reference=payment?.externalReference;
  if(typeof reference!=="string" || !/^pitacco:commercial:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(reference)) return null;
  if(!/^pay_[A-Za-z0-9_-]{1,100}$/.test(payment.id || "") ||
     !/^cus_[A-Za-z0-9_-]{1,100}$/.test(payment.customer || "") ||
     typeof payment.status!=="string" || !/^[A-Z_]{1,60}$/.test(payment.status) ||
     typeof payment.value!=="number" || !Number.isFinite(payment.value)) throw new Error("invalid_provider_payment");
  const cents=Math.round(payment.value*100);
  if(!Number.isSafeInteger(cents) || cents<=0 || Math.abs(payment.value*100-cents)>0.000001) throw new Error("invalid_provider_amount");
  const headers={"content-type":"application/json",apikey:serviceKey};
  if(serviceKey.startsWith("eyJ")) headers.authorization="Bearer "+serviceKey;
  const response=await fetcher(new URL("/rest/v1/rpc/pitacco_reconcile_commercial_asaas_charge",supabaseUrl),{
    method:"POST",headers,signal,redirect:"error",
    body:JSON.stringify({p_environment:environment,p_payment_id:payment.id,p_customer_id:payment.customer,p_reference:reference,p_amount_cents:cents,p_status:payment.status})
  });
  if(!response.ok) throw new Error("commercial_sync_unavailable");
  const outcome=await response.json();
  if(!["unlinked","pending","confirmed","received","review_required"].includes(outcome)) throw new Error("invalid_sync_result");
  return outcome;
}
