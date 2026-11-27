// Read-only board transport for the original Pedidos cards. No provider calls.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createMerchantBoard({store,scopedFetch}){
 if(!UUID.test(store??'')||typeof scopedFetch!=='function')throw Error('Sessão inválida.');
 let active=true,flight=null;const abort=new AbortController();
 const base='/api/v1/stores/'+store+'/';
 function stop(){active=false;abort.abort();}
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
   return {orders,deliveries,couriers,settings:settings.data};
  })().finally(()=>{flight=null;});return flight;
 }
 return {read,stop};
}
