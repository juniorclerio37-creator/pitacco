export const emptyAddress=()=>({street:'',number:'',neighborhood:'',city:'',state:'',postal:'',extra:''});
export function composeAddress(value){
 const a=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,String(v??'').trim()]));
 const postal=(a.postal||'').replace(/\D/g,'');
 if((a.street||'').length<3||!a.number||!a.neighborhood||!a.city||!(/^[A-Z]{2}$/.test((a.state||'').toUpperCase()))||(postal&&postal.length!==8))return '';
 return [a.street,a.number,a.neighborhood,a.city,a.state.toUpperCase(),postal?'CEP '+postal:'',a.extra].filter(Boolean).join(', ');
}
export function currentQuote(q,address,point,now=Date.now()){
 return Boolean(q?.quote_id&&q.address===address&&q.pointKey===JSON.stringify(point??null)&&q.fee!=null&&Number.isFinite(Number(q.fee))&&Number(q.fee)>=0&&Date.parse(q.expires_at)>now);
}
