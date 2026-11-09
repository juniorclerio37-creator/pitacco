const coordinate=p=>p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180;
export function validateRoute(data,matrix,now=Date.now()){
 const {store,delivery,courier,gps,stops}=data;
 const reject=reason=>({compatible:false,reason});
 if(!coordinate(store)||!coordinate(delivery)||!coordinate(gps)||!courier.active||!courier.available||courier.fleet_type!=='propria'||courier.store_id!==store.id||now-Date.parse(gps.observed_at)>90000||Date.parse(gps.observed_at)>now+5000||!Number.isFinite(Date.parse(gps.observed_at)))return reject('GPS ou disponibilidade inválidos');
 if(delivery.status!=='pendente'||delivery.courier_id||delivery.logistics_provider!=='loja'||stops.length>=store.max_orders_per_trip||stops.some(s=>s.departed_at||!s.batch_id))return reject('Rota indisponível');
 const destinations=[...stops,delivery];
 if(destinations.some(p=>!coordinate(p)||!Number.isFinite(Date.parse(p.deliver_by))||Date.parse(p.deliver_by)<=now))return reject('Coordenadas ou prazos ausentes');
 // Opposite headings fail even when the road matrix suggests a short connection.
 const vector=p=>[(p.longitude-store.longitude)*Math.cos(store.latitude*Math.PI/180),p.latitude-store.latitude];
 for(let a=0;a<destinations.length;a++)for(let b=a+1;b<destinations.length;b++){const u=vector(destinations[a]),v=vector(destinations[b]);if(u[0]*v[0]+u[1]*v[1]<0)return reject('Destinos em direções opostas')}
 // Matrix indexes: courier, store, existing stops, new delivery. Includes real directed roads.
 const n=destinations.length+2;
 if(!matrix||!['durations','distances'].every(k=>Array.isArray(matrix[k])&&matrix[k].length===n&&matrix[k].every(row=>Array.isArray(row)&&row.length===n&&row.every(x=>Number.isFinite(x)&&x>=0))))return reject('Matriz viária incompleta');
 let at=1,time=matrix.durations[0][1],distance=matrix.distances[0][1];
 const remaining=destinations.map((p,i)=>({...p,index:i+2})),sequence=[];
 while(remaining.length){remaining.sort((a,b)=>matrix.durations[at][a.index]-matrix.durations[at][b.index]);const next=remaining.shift();time+=matrix.durations[at][next.index]+120;distance+=matrix.distances[at][next.index];
  const directTime=matrix.durations[0][1]+matrix.durations[1][next.index]+120;
  const directDistance=matrix.distances[0][1]+matrix.distances[1][next.index];
  if(time>directTime*1.35||distance>Math.max(directDistance*1.35,100)||now+time*1000>Date.parse(next.deliver_by))return reject('Desvio excessivo ou prazo inviável');
  sequence.push(next.id);at=next.index;
 }
 return {compatible:true,method:'directed-road-matrix',sequence,duration_seconds:time,distance_m:distance,approach_seconds:matrix.durations[0][1]};
}
