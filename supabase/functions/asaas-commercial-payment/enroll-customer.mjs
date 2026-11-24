// Only an owner-authorized request may supply verified billing identity.
// Never log or persist the submitted CPF/CNPJ in Pitacco's integration tables.
export function validDocument(value){
 const d=String(value||'').replace(/[.\-/\s]/g,'');
 if(!/^\d{11}$|^\d{14}$/.test(d)||/^(\d)\1+$/.test(d))return null;
 const n=[...d].map(Number);
 if(n.length===11){
  for(const size of [9,10]){
   const sum=n.slice(0,size).reduce((a,v,i)=>a+v*(size+1-i),0);
   const digit=(sum*10)%11;
   if((digit===10?0:digit)!==n[size])return null;
  }
 }else{
  for(const size of [12,13]){
   const w=size===12?[5,4,3,2,9,8,7,6,5,4,3,2]:[6,5,4,3,2,9,8,7,6,5,4,3,2];
   const r=n.slice(0,size).reduce((a,v,i)=>a+v*w[i],0)%11;
   if((r<2?0:11-r)!==n[size])return null;
  }
 }
 return d;
}
export async function enrollCustomer({storeId,name,document,reservation,apiKey,fetcher=fetch}){
 const cpfCnpj=validDocument(document);
 if(!cpfCnpj||typeof name!=='string'||name.trim().length<3||name.length>150||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(storeId)||!['reserved','recover_only'].includes(reservation)||!apiKey)throw Error('invalid_enrollment');
 const externalReference='pitacco:store:'+storeId;
 const headers={accept:'application/json','content-type':'application/json',access_token:apiKey,'user-agent':'Pitacco/1.0'};
 const request=(url,init={})=>fetcher(url,{...init,headers,redirect:'error',signal:AbortSignal.timeout(10000)});
 const valid=c=>c&&/^cus_[A-Za-z0-9_-]{1,100}$/.test(c.id)&&c.externalReference===externalReference&&validDocument(c.cpfCnpj)===cpfCnpj&&!c.deleted;
 const linked=c=>({outcome:'link_required',customer_id:c.id});
 try{
  const lookup=new URL('/v3/customers','https://api.asaas.com');lookup.searchParams.set('externalReference',externalReference);lookup.searchParams.set('limit','2');
  const found=await request(lookup);if(!found.ok)return {outcome:'review_required'};
  const list=await found.json();
  if(!Array.isArray(list.data)||list.hasMore!==false||list.totalCount!==list.data.length)return {outcome:'review_required'};
  if(list.data.length===1)return valid(list.data[0])?linked(list.data[0]):{outcome:'review_required'};
  if(list.data.length>1||reservation==='recover_only')return {outcome:'review_required'};
  // Search by document too: never silently create a second Asaas customer or adopt another store's record.
  const byDoc=new URL('/v3/customers','https://api.asaas.com');byDoc.searchParams.set('cpfCnpj',cpfCnpj);byDoc.searchParams.set('limit','2');
  const docResult=await request(byDoc);if(!docResult.ok)return {outcome:'review_required'};
  const matches=await docResult.json();
  if(!Array.isArray(matches.data)||matches.hasMore!==false||matches.totalCount!==0||matches.data.length!==0)return {outcome:'review_required'};
  const created=await request(new URL('/v3/customers','https://api.asaas.com'),{method:'POST',body:JSON.stringify({name:name.trim(),cpfCnpj,externalReference,notificationDisabled:true})});
  if(!created.ok)return {outcome:'review_required'};
  const customer=await created.json();
  return valid(customer)?linked(customer):{outcome:'review_required'};
 }catch{return {outcome:'review_required'};}
}
