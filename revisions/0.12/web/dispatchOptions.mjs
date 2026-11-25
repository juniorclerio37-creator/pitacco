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
  const jobs=stops.filter(d=>d.courier_id===c.id&&!['entregue','cancelada'].includes(d.status));
  const pos=positions.find(p=>p.courier_id===c.id),age=pos?(now-Date.parse(pos.observed_at))/1000:Infinity;
  const fresh=Number.isFinite(age)&&age>=-5&&age<90,online=Boolean(c.available&&fresh),inRoute=jobs.some(d=>d.status==='retirada'),full=jobs.length>=limit;
  return {c,jobs,fresh,online,inRoute,full,age:Math.max(0,Math.floor(age)),distance:fresh?kmBetween(pos,store):null,blocked:!online||inRoute||full};
 }).sort((a,b)=>Number(a.blocked)-Number(b.blocked)||a.jobs.length-b.jobs.length||(a.distance??Infinity)-(b.distance??Infinity)||String(a.c.name).localeCompare(String(b.c.name)));
}
