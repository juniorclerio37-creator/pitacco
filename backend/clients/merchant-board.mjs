// Board and explicitly enabled own-order actions. No provider calls.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createMerchantBoard({store,scopedFetch}){
 if(!UUID.test(store??'')||typeof scopedFetch!=='function')throw Error('Sessão inválida.');
 let active=true,flight=null,writing=false,last=null;const abort=new AbortController();
 const pendingReprints=new Map();
 const base='/api/v1/stores/'+store+'/';
 function stop(){active=false;last=null;pendingReprints.clear();abort.abort();}
 async function get(path){
  if(!active)throw Error('Sessão encerrada.');
  const response=await scopedFetch(base+path,{headers:{Accept:'application/json'},signal:AbortSignal.any([abort.signal,AbortSignal.timeout(8000)])});
  if(!active)throw Error('Sessão encerrada.');
  if([401,403,404].includes(response.status)){stop();throw Error('Pedidos não autorizados.');}
  if(!response.ok)throw Error('Pedidos indisponíveis.');
  const body=await response.json();
  if(!active)throw Error('Sessão encerrada.');
  return body;
 }
 async function pages(path,source){
  const rows=[],ids=new Set();
  for(let offset=0;offset<=500;offset+=100){
   const body=await get(path+'?limit=100&offset='+offset);
   if(!Array.isArray(body.data)||body.limit!==100||body.offset!==offset||body.data.length>100)throw Error('Paginação inconsistente.');
   for(const row of body.data){
    if(!UUID.test(row?.id??'')||row.store_id!==store||ids.has(row.id)||(source&&row.source!==source))throw Error('Pedido ou entrega fora do escopo.');
    ids.add(row.id);rows.push(row);
   }
   if(body.data.length<100)return rows;
  }
  // No silently truncated board or misleading totals.
  throw Error('Volume acima do limite do ensaio.');
 }
 function read(){
  if(!active)return Promise.reject(Error('Sessão encerrada.'));
  if(flight)return flight;
  flight=(async()=>{
   const [own,ifood,ownDelivery,ifoodDelivery,couriers,settings]=await Promise.all([
    pages('orders/own-board','proprio'),pages('orders/ifood-board','ifood'),
    pages('own-logistics/deliveries','proprio'),pages('own-logistics/ifood-deliveries','ifood'),
    pages('own-logistics/couriers'),get('operation-settings')
   ]);
   if(!active)throw Error('Sessão encerrada.');
   const orders=[...own,...ifood], ids=new Map(orders.map(o=>[o.id,o.source]));
   if(ids.size!==orders.length||orders.some(o=>typeof o.receipt!=='object'||!o.receipt||Array.isArray(o.receipt)))throw Error('Pedidos inconsistentes.');
   const deliveries=[...ownDelivery,...ifoodDelivery].filter(d=>ids.has(d.order_id));
   if(new Set(deliveries.map(d=>d.order_id)).size!==deliveries.length||
      deliveries.some(d=>ids.get(d.order_id)!==d.source||d.logistics_provider!=='loja'))throw Error('Entregas inconsistentes.');
   if(settings?.data?.store_id!==store||!Array.isArray(settings.data.acceptance_settings)||!Array.isArray(settings.data.print_sectors)||
      [...settings.data.acceptance_settings,...settings.data.print_sectors].some(s=>s.store_id!==store))throw Error('Configuração inconsistente.');
   orders.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||b.id.localeCompare(a.id));
   last={orders,deliveries,couriers,settings:settings.data};
   return last;
  })().catch(e=>{last=null;throw e;}).finally(()=>{flight=null;});return flight;
 }
 async function act(id,action,reason){
  if(!active)throw Error('Sessão encerrada.');
  if(writing)throw Error('Operação em andamento.');
  if(!UUID.test(id??'')||!['accept','reject','ready','complete_pickup','cancel'].includes(action))throw Error('Ação não suportada.');
  const order=last?.orders.find(o=>o.id===id);
  if(!order||order.source!=='proprio'||order.store_id!==store)throw Error('Pedido próprio não autorizado.');
  if((['accept','reject'].includes(action)&&order.status!=='pending')||
     (action==='ready'&&(order.status!=='accepted'||order.preparation_status!=='preparing'))||
     (action==='cancel'&&(!['pending','accepted'].includes(order.status)||order.preparation_status==='completed'))||
     (action==='complete_pickup'&&(order.status!=='accepted'||order.preparation_status!=='ready'||order.receipt.logistics!=='retirada')))
   throw Error('Etapa não permitida.');
  const body={action};
  if(action==='reject'||action==='cancel'){
   if(typeof reason!=='string'||reason.trim().length<3||reason.trim().length>240)throw Error(action==='cancel'?'Informe o motivo do cancelamento.':'Informe o motivo da recusa.');
   body.reason=reason.trim();
  }else if(reason!==undefined)throw Error('Motivo não suportado.');
  writing=true;
  try{
   // Do not replay a mutation after a lost response or a session renewal.
   // The server remains the source of truth and checks the current transition.
   const res=await scopedFetch(base+'orders/'+id+'/actions',{method:'POST',
    headers:{Accept:'application/json','Content-Type':'application/json'},
    body:JSON.stringify(body),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(8000)])});
   if(!active)throw Error('Sessão encerrada.');
   if([401,403,404].includes(res.status)){stop();throw Error('Pedido não autorizado.');}
   if(!res.ok)throw Error(res.status===409?'Etapa alterada. Atualize o pedido.':'Resultado não confirmado. Atualize antes de tentar novamente.');
   const {data}=await res.json();
   if(!active)throw Error('Sessão encerrada.');
   if(data?.id!==id||data.store_id!==store||
      (action==='accept'&&data.status!=='accepted')||
      (action==='reject'&&data.status!=='rejected')||
      (action==='cancel'&&data.status!=='cancelled')||
      (action==='ready'&&(data.status!=='accepted'||data.preparation_status!=='ready'))||
      (action==='complete_pickup'&&(data.status!=='accepted'||data.preparation_status!=='completed')))
    throw Error('Resultado não confirmado. Atualize antes de tentar novamente.');
   return data;
  }finally{
   // Any pre-mutation poll might be stale. Wait for it before a fresh read.
   if(flight)try{await flight;}catch{}
   last=null;writing=false;
  }
 }
 async function reprint(id){
  if(!active)throw Error('Sessão encerrada.');
  if(writing)throw Error('Operação em andamento.');
  const order=last?.orders.find(o=>o.id===id);
  if(!order||order.store_id!==store||order.status!=='accepted')throw Error('Reimpressão indisponível.');
  const endpoint=order.source==='ifood'?'ifood-reprint':'reprint';
  const requestId=pendingReprints.get(id)??globalThis.crypto.randomUUID();
  pendingReprints.set(id,requestId);
  writing=true;
  try{
   const response=await scopedFetch(base+'orders/'+id+'/'+endpoint,{
    method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},
    body:JSON.stringify({request_id:requestId,reason:'Reimpressão solicitada no painel'}),
    signal:AbortSignal.any([abort.signal,AbortSignal.timeout(8000)])
   });
   if(!active)throw Error('Sessão encerrada.');
   if(response.status===401||response.status===403){stop();throw Error('Reimpressão não autorizada.');}
   if(response.status===404||response.status===409)throw Error('Reimpressão indisponível.');
   if(!response.ok||(await response.json())?.data?.queued!==true)throw Error('Envio à fila não confirmado.');
   if(!active)throw Error('Sessão encerrada.');
   pendingReprints.delete(id);
  }finally{writing=false;}
 }
 return {read,act,reprint,stop};
}
