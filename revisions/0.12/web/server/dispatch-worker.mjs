// Run only on a protected server. Never bundle the service key in React/Tauri.
import {validateRoute} from './routeValidation.mjs';
const {SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,ROUTING_URL}=process.env;
if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY||!ROUTING_URL)throw Error('Configure SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e ROUTING_URL (OSRM privado/contratado).');
const routing=new URL(ROUTING_URL);if(routing.protocol!=='https:')throw Error('ROUTING_URL deve usar HTTPS');
if(routing.hostname==='router.project-osrm.org')throw Error('Não use o servidor público de demonstração com dados de clientes');
async function rpc(name,args={}){const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error(`RPC ${name}: ${r.status}`);return r.json()}
async function cycle(){const candidates=await rpc('dispatch_candidates'),valid=[];
 for(const candidate of candidates){try{
  const {data}=candidate,points=[data.gps,data.store,...data.stops,data.delivery];
  if(points.some(p=>!p||!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude)))continue;
  const coordinates=points.map(p=>`${p.longitude},${p.latitude}`).join(';');
  const r=await fetch(`${ROUTING_URL.replace(/\/$/,'')}/table/v1/driving/${coordinates}?annotations=duration,distance`,{signal:AbortSignal.timeout(5000)});
  if(!r.ok)continue;const matrix=await r.json();if(matrix.code!=='Ok')continue;
  const evidence=validateRoute(data,matrix);if(evidence.compatible)valid.push({...candidate,evidence:{...evidence,provider:routing.origin}});
 }catch{console.warn('Validação viária indisponível; pedido permanece aguardando')}}
 valid.sort((a,b)=>a.evidence.approach_seconds-b.evidence.approach_seconds||a.evidence.duration_seconds-b.evidence.duration_seconds);
 for(const item of valid){try{await rpc('commit_auto_dispatch',{p_check:item.token,p_evidence:item.evidence});console.log('Alocação confirmada pelo servidor')}catch{console.warn('Alocação não confirmada; será recalculada')}}
}
let stop=false;process.on('SIGTERM',()=>{stop=true});process.on('SIGINT',()=>{stop=true});
while(!stop){try{await cycle()}catch{console.warn('Servidor indisponível; nova tentativa em 10 segundos')}if(process.env.DISPATCH_ONCE==='1')break;await new Promise(r=>setTimeout(r,10000))}
