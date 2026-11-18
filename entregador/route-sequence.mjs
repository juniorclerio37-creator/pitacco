// Sequência sugerida para lotes previamente agrupados e autorizados pela loja.
// Heurística geográfica entre paradas: NÃO é previsão de tempo viário, nem
// modifica despacho/atribuição. Maps/Waze seguem responsáveis pelas ruas.
function point(value) {
  const present=x=>x!==null&&x!==undefined&&x!==''&&typeof x!=='boolean';
  if(!present(value?.latitude)||!present(value?.longitude))return null;
  const lat=Number(value.latitude),lon=Number(value.longitude);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||
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
function groupKey(delivery) {
  return String(delivery.store_id)+':'+String(delivery.batch_id);
}
// `lastStops` é um mapa transitório em memória com coordenadas da última
// entrega CONFIRMADA; nunca contém endereços, nomes nem PINs.
export function suggestedBatchRoutes(deliveries,origins=new Map(),lastStops=new Map()) {
  const groups=new Map();
  for(const delivery of Array.isArray(deliveries)?deliveries:[]) {
    if(!delivery?.batch_id||!delivery?.store_id||
       !['aceita','retirada'].includes(delivery.status)||
       delivery.logistics_provider!=='loja')continue;
    const key=groupKey(delivery);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(delivery);
  }
  return [...groups].filter(([,stops])=>stops.length>1).map(([id,stops])=>{
    // Uma chegada já registrada continua sendo a primeira parada até
    // ser confirmada: não sugerir seguir ao próximo cliente antes do PIN.
    const arrived=stops.filter(d=>d.arrived_at).sort((a,b)=>
      String(a.arrived_at).localeCompare(String(b.arrived_at)));
    const queued=stops.filter(d=>!d.arrived_at);
    const last=point(lastStops.get(id));
    const store=point(origins.get(stops[0].store_id));
    let cursor=arrived.length?point(arrived[arrived.length-1]):last||store;
    const canOrder=!!cursor&&stops.every(d=>!!point(d));
    let anchor=arrived.length?'arrival':last?'last-stop':'store';
    const ordered=arrived.map(delivery=>({delivery,distance:null}));
    if(canOrder){
      // Vizinho mais próximo a partir da parada anterior, em vez de
      // ordenar todos os destinos pela distância direta até a loja.
      const remaining=queued.slice();
      while(remaining.length){
        let chosen=0,best=Infinity;
        for(let i=0;i<remaining.length;i++){
          const km=distanceKm(cursor,point(remaining[i]));
          if(km<best){best=km;chosen=i;}
        }
        const [delivery]=remaining.splice(chosen,1);
        ordered.push({delivery,distance:best});
        cursor=point(delivery);
      }
    }else{
      ordered.push(...queued.map(delivery=>({delivery,distance:null})));
      anchor='unsorted';
    }
    return {id,batchId:stops[0].batch_id,storeId:stops[0].store_id,
      estimated:canOrder,anchor,stops:ordered};
  });
}
