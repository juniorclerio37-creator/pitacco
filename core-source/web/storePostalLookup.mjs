// Brazilian postal lookup: only the eight postal digits leave the merchant app.
export const postalDigits=value=>String(value??'').replace(/\D/g,'').slice(0,8);
export const formatPostal=value=>{const digits=postalDigits(value);return digits.length>5?digits.slice(0,5)+'-'+digits.slice(5):digits;};
export const postalAddressFields=['address','neighborhood','city','state'];
export function mergePostalAddress(current,original,found,cep){
 if(postalDigits(current.postal_code)!==cep)return current;
 const next={...current};
 for(const key of postalAddressFields){
  if(String(current[key]??'')===String(original[key]??'')&&typeof found[key]==='string'&&found[key].trim())next[key]=found[key].trim();
 }
 return next;
}
export async function lookupPostalAddress(value,{signal,fetcher=globalThis.fetch,timeout=6500}={}){
 const cep=postalDigits(value);
 if(cep.length!==8)throw Error('Informe os oito dígitos do CEP.');
 const controller=new AbortController();
 const abort=()=>controller.abort();
 if(signal?.aborted)abort();
 signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,timeout);
 try{
  const response=await fetcher('https://viacep.com.br/ws/'+cep+'/json/',{signal:controller.signal,credentials:'omit'});
  if(!response.ok)throw Error('Consulta de CEP indisponível.');
  const data=await response.json();
  if(data?.erro===true||data?.erro==='true')throw Error('CEP não encontrado.');
  const clean=x=>typeof x==='string'?x.trim():'';
  const result={address:clean(data?.logradouro),neighborhood:clean(data?.bairro),city:clean(data?.localidade),state:clean(data?.uf).toUpperCase()};
  if(!result.city||!/^[A-Z]{2}$/.test(result.state)||postalDigits(data?.cep)!==cep)throw Error('O serviço retornou um endereço incompleto ou incorreto.');
  return result;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

export async function lookupStorePostalAddress(client,storeId,value,{signal}={}){
 const cep=postalDigits(value);
 if(cep.length!==8)throw Error('Informe os oito dígitos do CEP.');
 if(signal?.aborted)throw Error('Consulta cancelada.');
 const {data,error}=await client.functions.invoke('store-postal-lookup',{body:{cep,store_id:storeId}});
 if(signal?.aborted)throw Error('Consulta cancelada.');
 if(error){
  let detail;try{detail=(await error.context?.json())?.error}catch{}
  throw Error(detail==='CEP não encontrado.'?detail:'Consulta de CEP indisponível.');
 }
 if(data?.error)throw Error(data.error==='CEP não encontrado.'?data.error:'Consulta de CEP indisponível.');
 const result=data?.address;
 if(data?.cep!==cep||!result||typeof result.city!=='string'||!result.city.trim()||!/^[A-Z]{2}$/.test(result.state))throw Error('O serviço retornou um endereço incompleto ou incorreto.');
 return Object.fromEntries(postalAddressFields.map(key=>[key,typeof result[key]==='string'?result[key].trim():'']));
}
