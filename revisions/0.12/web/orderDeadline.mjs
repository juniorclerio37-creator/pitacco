const terminal=new Set(['completed','cancelled','rejected','historical']);
const date=v=>typeof v==='string'?Date.parse(v):NaN;
const marketplaces=new Set(['ifood','99food','keeta']);
const fmt=n=>{const a=Math.abs(n);return String(Math.floor(a/60)).padStart(2,'0')+':'+String(a%60).padStart(2,'0')};
export function orderDeadline(order,delivery,stage,now=Date.now()){
 if(!order||terminal.has(stage)||['cancelled','rejected','historical'].includes(order.status))return null;
 const r=order.receipt||{},marketplace=marketplaces.has(order.source);
 if(marketplace&&(!['analysis','preparing','scheduled'].includes(stage)||['ready','completed'].includes(order.preparation_status)))return null;
 if(!marketplace&&(order.source!=='proprio'||(delivery?.logistics_provider||r.logistics)!=='loja'||delivery?.status==='entregue'))return null;
 const due=date(marketplace?r.provider_preparation_due_at:r.delivery_eta?.latest_at||delivery?.deliver_by);
 const label=marketplace?'Preparo':'Entrega';
 if(!Number.isFinite(due))return {state:'unknown',label,text:'Prazo indisponível'};
 const seconds=Math.ceil((due-now)/1000);
 return {state:seconds<=0?'late':seconds<=600?'warning':'ok',label:seconds<=0?label+' em atraso':label+' restante',text:fmt(seconds),due};
}
