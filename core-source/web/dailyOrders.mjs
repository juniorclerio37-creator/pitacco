const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
export function businessDay(value=new Date()){
 const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';
 const parts=Object.fromEntries(dayFormat.formatToParts(d).map(p=>[p.type,p.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
}
export function isDailyOrder(order,stage,day){
 if(['analysis','preparing','ready','delivery','scheduled'].includes(stage))return true;
 return businessDay(order.created_at)===day;
}
export async function fetchDailyOrders(client,store){
 const rows=[],size=500;
 for(let offset=0;;offset+=size){
  const {data,error}=await client.rpc('pitacco_daily_operational_orders',{p_store:store}).order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+size-1);
  if(error)return {data:null,error};rows.push(...(data||[]));if(!data||data.length<size)return {data:rows,error:null};
 }
}
