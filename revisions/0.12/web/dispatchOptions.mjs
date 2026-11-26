export function kmBetween(a,b){
 if([a?.latitude,a?.longitude,b?.latitude,b?.longitude].some(n=>n==null||n===''||!Number.isFinite(Number(n))))return null;
 const [x,y,u,v]=[a.latitude,a.longitude,b.latitude,b.longitude].map(Number);
 if(Math.abs(x)>90||Math.abs(u)>90||Math.abs(y)>180||Math.abs(v)>180)return null;
 const r=Math.PI/180,h=Math.sin((u-x)*r/2)**2+Math.cos(x*r)*Math.cos(u*r)*Math.sin((v-y)*r/2)**2;
 return 6371*2*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))));
}
export function dispatchOptions({couriers=[],positions=[],stops=[],store,now=Date.now()}){
 const limit=Math.max(1,Number(store?.max_orders_per_trip)||1);
 return couriers.filter(c=>c.fleet_type==='propria'&&c.active!==false).map(c=>{
  const jobs=stops.filter(d=>d.courier_id===c.id&&!['entregue','cancelada'].includes(d.status)&&!d.capacity_released_at);
  const pos=positions.find(p=>p.courier_id===c.id),age=pos?(now-Date.parse(pos.observed_at))/1000:Infinity;
  const fresh=Number.isFinite(age)&&age>=-5&&age<90,online=Boolean(c.available&&fresh),inRoute=jobs.some(d=>d.status==='retirada'),full=jobs.length>=limit;
  return {c,jobs,fresh,online,inRoute,full,age:Math.max(0,Math.floor(age)),distance:fresh?kmBetween(pos,store):null,blocked:!online||inRoute||full};
 }).sort((a,b)=>Number(a.blocked)-Number(b.blocked)||a.jobs.length-b.jobs.length||(a.distance??Infinity)-(b.distance??Infinity)||String(a.c.name).localeCompare(String(b.c.name)));
}


/** Only compare complete, numbered address strings; never infer a match from an empty
 * address or a neighborhood alone. Coordinates are advisory, not proof of identity. */
function addressKey(value){
 if(typeof value!=='string')return '';
 const key=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 if(key.length<15||!/[a-z]/.test(key)||!/\b\d+\b/.test(key)||key.split(' ').length<4)return '';
 return key;
}
export function routeDestinationRelation(a,b){
 if(!a||!b)return 'unknown';
 const ka=addressKey(a.address),kb=addressKey(b.address);
 const km=kmBetween(a,b);
 if(ka&&ka===kb)return km!==null&&km>0.15?'check':'same';
 if(km!==null&&km<=0.05&&!(Number(a.latitude)===0&&Number(a.longitude)===0)&&!(Number(b.latitude)===0&&Number(b.longitude)===0))return 'nearby';
 return 'check';
}
export function routeDestinationSummary(stops){
 if(!Array.isArray(stops)||stops.length<2)return 'unknown';
 let allSame=true;
 for(let i=0;i<stops.length;i++)for(let j=i+1;j<stops.length;j++){
  const relation=routeDestinationRelation(stops[i],stops[j]);
  if(relation!=='same'&&relation!=='nearby')return 'check';
  if(relation!=='same')allSame=false;
 }
 return allSame?'same':'nearby';
}
export function routeDestinationMessage(relation){
 return relation==='same'?'Mesmo endereço identificado. Confira os prazos e os pedidos antes de confirmar.':relation==='nearby'?'Destinos muito próximos (até 50 m em linha reta). Confira os endereços e prazos.':'Confira os endereços e prazos. O trajeto por ruas não foi calculado.';
}
