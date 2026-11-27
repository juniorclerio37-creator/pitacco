import {freshGps} from '../../entregador/dispatch-map.mjs';
import {suggestedBatchRoutes} from '../../entregador/route-sequence.mjs';
export function createCourierMapReader({token,fetcher=globalThis.fetch}){
 if(typeof token!=='string'||!token)throw Error('Sessão inválida.');
 let active=true,flight=null;const abort=new AbortController();
 function stop(){active=false;token='';abort.abort();}
 function read(){
  if(!active)return Promise.reject(Error('Sessão encerrada.'));
  if(flight)return flight;
  flight=(async()=>{
   const res=await fetcher('/api/v1/courier/map',{headers:{Accept:'application/json',Authorization:'Bearer '+token},cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(8000)])});
   if(!active)throw Error('Sessão encerrada.');
   if([401,403,404].includes(res.status)){stop();throw Error('Mapa não autorizado.');}
   if(!res.ok)throw Error('Mapa indisponível.');
   const {data}=await res.json();
   if(!active||!Array.isArray(data?.origins)||!Array.isArray(data?.deliveries))throw Error('Mapa indisponível.');
   const origins=new Map(data.origins.map(s=>[s.store_id,s]));
   if(new Set(data.deliveries.map(d=>d.id)).size!==data.deliveries.length||data.deliveries.some(d=>!origins.has(d.store_id)||!['atribuida','aceita','retirada'].includes(d.status)||d.logistics_provider!=='loja'))throw Error('Mapa inconsistente.');
   return {origins:data.origins,deliveries:data.deliveries,numbers:Object.fromEntries(data.deliveries.map(d=>[d.id,d.public_number])),gps:freshGps(data.gps)?data.gps:null,routes:suggestedBatchRoutes(data.deliveries,origins)};
  })().finally(()=>{flight=null;});
  return flight;
 }
 return {read,stop};
}
