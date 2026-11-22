// Detecta a proximidade do cliente sem alterar o estado de qualquer pedido.
// Uma chegada é apenas SUGERIDA. A confirmação continua exigindo o clique do
// entregador e a validação de acesso/etapa do Supabase.
const RAD = Math.PI/180;
export function distanceMeters(a,b){
 const lat1=Number(a?.latitude),lon1=Number(a?.longitude),lat2=Number(b?.latitude),lon2=Number(b?.longitude);
 if(![lat1,lon1,lat2,lon2].every(Number.isFinite))return Infinity;
 if(Math.abs(lat1)>90||Math.abs(lat2)>90||Math.abs(lon1)>180||Math.abs(lon2)>180)return Infinity;
 if((lat1===0&&lon1===0)||(lat2===0&&lon2===0))return Infinity;
 const dLat=(lat2-lat1)*RAD,dLon=(lon2-lon1)*RAD;
 const v=Math.sin(dLat/2)**2+Math.cos(lat1*RAD)*Math.cos(lat2*RAD)*Math.sin(dLon/2)**2;
 return 6371000*2*Math.atan2(Math.sqrt(v),Math.sqrt(Math.max(0,1-v)));
}
export function arrivalProximity(deliveries,fix,seen=new Map(),now=Date.now()){
 const observed=Date.parse(fix?.observed_at||"");
 const accuracy=Number(fix?.accuracy_m);
 const valid=Number.isFinite(observed)&&observed<=now+10000&&now-observed<=40000
  &&Number.isFinite(accuracy)&&accuracy>=0&&accuracy<=40;
 const candidates=valid?(Array.isArray(deliveries)?deliveries:[]).filter(d=>
  d?.status==="retirada"&&!d.arrived_at&&d.logistics_provider==="loja"
  &&d.latitude!=null&&d.longitude!=null&&String(d.address||"").trim()
 ).map(d=>({d,distance:distanceMeters(fix,d)}))
  .filter(item=>item.distance<=75).sort((a,b)=>a.distance-b.distance):[];
 const closest=candidates[0]||null;
 // Não registrar várias "chegadas" ao mesmo tempo em uma rota agrupada.
 for(const id of seen.keys())if(id!==closest?.d.id)seen.delete(id);
 if(!closest)return null;
 const {d,distance}=closest;
 let state=seen.get(d.id);
 if(!state||observed<state.last||observed-state.last>90000)
  state={first:observed,last:observed,count:1};
 else if(observed!==state.last){
  if(observed-state.last>=6000)state.count=Math.min(2,state.count+1);
  state.last=observed;
 }
 seen.set(d.id,state);
 if(state.count<2)return null;
 return {deliveryId:d.id,distanceMeters:Math.round(distance),accuracyMeters:accuracy};
}
