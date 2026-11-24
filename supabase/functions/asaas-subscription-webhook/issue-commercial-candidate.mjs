// Server-only adapter. The reservation and customer mapping must be supplied by the trusted RPC.
const origins={production:'https://api.asaas.com',sandbox:'https://api-sandbox.asaas.com'};
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export async function issueReservedCharge({reservation:r,apiKey,fetcher=fetch}){
 if(!r||!['reserved','recover_only'].includes(r.outcome)||!Object.hasOwn(origins,r.environment)||!uuid.test(r.invoice_id)||!/^cus_[A-Za-z0-9_-]{1,100}$/.test(r.customer_id)||!Number.isSafeInteger(r.amount_cents)||r.amount_cents<=0||!['PIX','BOLETO','UNDEFINED'].includes(r.billing_type)||!/^\d{4}-\d{2}-\d{2}$/.test(r.due_date)||!apiKey)throw Error('invalid_reservation');
 const reference='pitacco:commercial:'+r.invoice_id;
 const headers={accept:'application/json','content-type':'application/json',access_token:apiKey,'user-agent':'Pitacco/1.0'};
 const request=(url,init={})=>fetcher(url,{...init,headers,redirect:'error',signal:AbortSignal.timeout(10000)});
 const lookup=new URL('/v3/payments',origins[r.environment]);
 lookup.searchParams.set('externalReference',reference);lookup.searchParams.set('limit','2');
 const validate=p=>p&&/^pay_[A-Za-z0-9_-]{1,100}$/.test(p.id)&&p.customer===r.customer_id&&p.externalReference===reference&&typeof p.value==='number'&&Math.abs(p.value*100-r.amount_cents)<0.000001&&p.dueDate===r.due_date&&p.billingType===r.billing_type&&!p.deleted;
 const result=p=>({outcome:'link_required',payment_id:p.id,customer_id:r.customer_id,invoice_id:r.invoice_id,amount_cents:r.amount_cents,environment:r.environment});
 try{
  const response=await request(lookup);
  if(!response.ok)return {outcome:'review_required'};
  const list=await response.json();
  if(!Array.isArray(list.data)||list.hasMore!==false||!Number.isInteger(list.totalCount)||list.totalCount!==list.data.length)return {outcome:'review_required'};
  if(list.data.length===1)return validate(list.data[0])?result(list.data[0]):{outcome:'review_required'};
  if(list.data.length>1||r.outcome==='recover_only')return {outcome:'review_required'};
  const created=await request(new URL('/v3/payments',origins[r.environment]),{method:'POST',body:JSON.stringify({customer:r.customer_id,billingType:r.billing_type,value:r.amount_cents/100,dueDate:r.due_date,externalReference:reference,description:'Pitacco — fatura comercial'})});
  if(!created.ok)return {outcome:'review_required'};
  const payment=await created.json();
  return validate(payment)?result(payment):{outcome:'review_required'};
 }catch{return {outcome:'review_required'};}
}
