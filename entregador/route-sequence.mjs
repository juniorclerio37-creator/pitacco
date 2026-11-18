// Sequência preliminar de lotes já agrupados pela loja.
// Não calcula distância viária nem ignora sentidos de circulação:
// Google Maps/Waze decidem o trajeto real de cada parada.
function point(value) {
  const lat=Number(value?.latitude),lon=Number(value?.longitude);
  const present=x=>x!==null&&x!==undefined&&x!==''&&typeof x!=='boolean';
  if(!present(value?.latitude)||!present(value?.longitude)||
     !Number.isFinite(lat)||!Number.isFinite(lon)||
     Math.abs(lat)>90||Math.abs(lon)>180||(lat===0&&lon===0))return null;
  return {lat,lon};
}
function distanceKm(a,b) {
  const rad=Math.PI/180;
  const dLat=(b.lat-a.lat)*rad,dLon=(b.lon-a.lon)*rad;
  const h=Math.sin(dLat/2)**2+
    Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLon/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function suggestedBatchRoutes(deliveries,origins=new Map()) {
  const groups=new Map();
  for(const delivery of Array.isArray(deliveries)?deliveries:[]) {
    if(!delivery?.batch_id||!delivery?.store_id||
       !['aceita','retirada'].includes(delivery.status)||
       delivery.logistics_provider!=='loja')continue;
    const key=String(delivery.store_id)+':'+String(delivery.batch_id);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(delivery);
  }
  return [...groups].filter(([,stops])=>stops.length>1).map(([id,stops])=>{
    const start=point(origins.get(stops[0].store_id));
    const positions=stops.map(point);
    const canOrder=!!start&&positions.every(Boolean);
    const ordered=canOrder?
      stops.map((delivery,index)=>({delivery,distance:distanceKm(start,positions[index])}))
        .sort((a,b)=>a.distance-b.distance||
          String(a.delivery.created_at||'').localeCompare(String(b.delivery.created_at||''))):
      stops.map(delivery=>({delivery,distance:null}));
    return {id,batchId:stops[0].batch_id,storeId:stops[0].store_id,
      estimated:canOrder,stops:ordered};
  });
}
