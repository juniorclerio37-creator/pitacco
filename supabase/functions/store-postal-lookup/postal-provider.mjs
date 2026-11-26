const clean=v=>typeof v==='string'?v.trim():'';
const digits=v=>String(v??'').replace(/\D/g,'');
const providers=[
 {name:'viacep',url:cep=>'https://viacep.com.br/ws/'+cep+'/json/',missing:(r,d)=>r.ok&&(d?.erro===true||d?.erro==='true'),map:d=>({cep:d?.cep,address:d?.logradouro,neighborhood:d?.bairro,city:d?.localidade,state:d?.uf})},
 {name:'brasilapi',url:cep=>'https://brasilapi.com.br/api/cep/v1/'+cep,missing:r=>r.status===404,map:d=>({cep:d?.cep,address:d?.street,neighborhood:d?.neighborhood,city:d?.city,state:d?.state})}
];
export async function resolvePostalAddress(cep,{fetcher=globalThis.fetch,timeout=4000}={}){
 if(!/^\d{8}$/.test(cep))return {status:400,error:'Informe os oito dígitos do CEP.'};
 let missing=0,partial=null;
 for(const p of providers){
  try{
   const r=await fetcher(p.url(cep),{signal:AbortSignal.timeout(timeout),headers:{Accept:'application/json'},redirect:'error'});
   const d=await r.json();
   if(p.missing(r,d)){missing++;continue;}
   if(!r.ok)continue;
   const raw=p.map(d),address={address:clean(raw.address),neighborhood:clean(raw.neighborhood),city:clean(raw.city),state:clean(raw.state).toUpperCase()};
   if(digits(raw.cep)!==cep||!address.city||!/^[A-Z]{2}$/.test(address.state))continue;
   const result={status:200,cep,address,provider:p.name};
   if(address.address&&address.neighborhood)return result;
   partial??=result;
  }catch{/* Try the other provider on timeout, outage or invalid payload. */}
 }
 return partial??(missing===providers.length?{status:404,error:'CEP não encontrado.'}:{status:503,error:'Consulta de CEP indisponível.'});
}
