/** Road-network trip optimizer. Matrix contains directed driving durations in seconds.
 * Index 0 is courier position, indices 1..N are candidate destinations.
 * Never fall back to straight-line distances for automatic dispatch.
 */
export function optimizeRoadTrip({orders,matrix,maxOrders=1,maxDetourRatio=1.35,serviceSeconds=120}) {
  if (!Array.isArray(orders)||!Array.isArray(matrix)||!Number.isInteger(maxOrders)||maxOrders<1||maxOrders>15) throw Error('Entrada inválida');
  const n=orders.length;
  if(matrix.length!==n+1||matrix.some(r=>!Array.isArray(r)||r.length!==n+1))throw Error('Matriz de rotas incompleta');
  const duration=(a,b)=>{const v=matrix[a][b];return Number.isFinite(v)&&v>=0?v:Infinity};
  const eligible=orders.map((o,i)=>({...o,_idx:i+1})).filter(o=>o.logistics_provider!=='marketplace'&&o.status==='pendente'&&Number.isFinite(duration(0,o._idx)));
  if(!eligible.length)return {selected:[],excluded:orders.map(o=>({id:o.id,reason:'Sem rota ou indisponível'})),durationSeconds:0,method:'road'};
  const best=eligible.reduce((a,b)=>duration(0,a._idx)<=duration(0,b._idx)?a:b);
  const chosen=[best];let current=best._idx,seconds=duration(0,current)+serviceSeconds;
  while(chosen.length<maxOrders){
    const possibilities=eligible.filter(o=>!chosen.includes(o)).map(o=>{
      const travel=duration(current,o._idx), direct=duration(0,o._idx);
      const projected=seconds+travel+serviceSeconds;
      const detour=projected/(direct+serviceSeconds);
      const deadline=o.deadlineSeconds??Infinity;
      return {o,travel,projected,detour,deadline};
    }).filter(p=>Number.isFinite(p.travel)&&p.detour<=maxDetourRatio&&p.projected<=p.deadline);
    if(!possibilities.length)break;
    possibilities.sort((a,b)=>a.travel-b.travel);
    const next=possibilities[0];chosen.push(next.o);seconds=next.projected;current=next.o._idx;
  }
  const selected=chosen.map(({_idx,...o})=>o);
  const ids=new Set(selected.map(o=>o.id));
  return {selected,excluded:orders.filter(o=>!ids.has(o.id)).map(o=>({id:o.id,reason:'Não elegível para esta viagem'})),durationSeconds:seconds,method:'road',warning:'Sugestão por tempo de percurso. Verifique prazos e regras dos marketplaces antes do despacho.'};
}
export async function fetchOsrmMatrix({origin,orders,endpoint='https://router.project-osrm.org',signal}){
  if(![origin,...orders].every(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180))throw Error('Coordenadas ausentes ou inválidas');
  if(orders.length>14)throw Error('Máximo de 14 destinos por consulta');
  const coords=[origin,...orders].map(p=>`${p.lng},${p.lat}`).join(';');
  const url=`${endpoint.replace(/\/$/,'')}/table/v1/driving/${coords}?annotations=duration`;
  const response=await fetch(url,{signal});
  if(!response.ok)throw Error('Serviço de rotas indisponível');
  const data=await response.json();
  if(data.code!=='Ok'||!Array.isArray(data.durations))throw Error('Matriz viária indisponível');
  return data.durations;
}
