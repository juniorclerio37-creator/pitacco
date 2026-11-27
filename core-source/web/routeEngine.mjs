/** DeliveryGestor route decision engine v0.8. Approximate geometry only.
 * Production dispatch must use road-network ETA and marketplace constraints.
 */
const rad = d => d * Math.PI / 180;
export function distanceKm(a,b){
  if (![a?.lat,a?.lng,b?.lat,b?.lng].every(Number.isFinite)) throw new Error('Coordenadas inválidas');
  const x=rad(b.lat-a.lat), y=rad(b.lng-a.lng);
  const h=Math.sin(x/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(y/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
function bearing(a,b){const lat1=rad(a.lat),lat2=rad(b.lat),d=rad(b.lng-a.lng);return Math.atan2(Math.sin(d)*Math.cos(lat2),Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(d));}
function angle(a,b){return Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)))*180/Math.PI;}
export function suggestTrip({origin,orders,maxOrders=3,maxDetourRatio=1.3,maxAngleDeg=65}){
  if(!origin || !Number.isInteger(maxOrders) || maxOrders<1) throw new Error('Origem ou limite inválido');
  const valid=orders.filter(o=>o.logistics_provider!=='marketplace' && o.status==='pendente' && Number.isFinite(o.lat) && Number.isFinite(o.lng));
  const sorted=[...valid].sort((a,b)=>distanceKm(origin,a)-distanceKm(origin,b));
  if(!sorted.length)return {selected:[],excluded:orders.map(o=>({id:o.id,reason:'Indisponível ou sem coordenadas'})),estimatedKm:0,method:'geodesic'};
  const selected=[sorted[0]],excluded=[];
  for(const candidate of sorted.slice(1)){
    if(selected.length>=maxOrders){excluded.push({id:candidate.id,reason:'Limite por viagem'});continue;}
    const first=selected[0];
    const direction=angle(bearing(origin,first),bearing(origin,candidate));
    if(direction>maxAngleDeg){excluded.push({id:candidate.id,reason:'Direção incompatível'});continue;}
    const route=[...selected,candidate];
    const direct=Math.max(...route.map(o=>distanceKm(origin,o)));
    let current=origin, length=0;
    for(const stop of route){length+=distanceKm(current,stop);current=stop;}
    if(length>direct*maxDetourRatio){excluded.push({id:candidate.id,reason:'Desvio excessivo'});continue;}
    selected.push(candidate);
  }
  let pos=origin,estimatedKm=0;
  for(const stop of selected){estimatedKm+=distanceKm(pos,stop);pos=stop;}
  const chosen=new Set(selected.map(o=>o.id));
  for(const o of orders)if(!chosen.has(o.id)&&!excluded.some(e=>e.id===o.id))excluded.push({id:o.id,reason:'Indisponível ou sem coordenadas'});
  return {selected,excluded,estimatedKm,method:'geodesic',warning:'Estimativa em linha reta. Não considera ruas, contramão, trânsito, horários ou prazos.'};
}
