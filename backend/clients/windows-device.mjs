// Experimental Windows lifecycle; host provides the matching same-store print client.
// No automatic binding, transfer, unbinding, or fallback to a legacy database.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createWindowsDevice({store,device,token,printClient,fetcher=globalThis.fetch,onState=()=>{},schedule=setTimeout,cancel=clearTimeout}){
 if(!UUID.test(store??'')||!UUID.test(device??'')||typeof token!=='string'||!token||typeof printClient?.syncAndReconcile!=='function'||typeof printClient?.stop!=='function')throw new TypeError('Sessão Windows inválida.');
 let active=true,started=false,timer=null,chain=Promise.resolve(),snapshot=null;
 const abort=new AbortController();
 function emit(state,extra={}){if(active)onState({state,snapshot,...extra});}
 function stop(){if(!active)return;active=false;token='';snapshot=null;abort.abort();if(timer!==null)cancel(timer);timer=null;printClient.stop();}
 async function post(op,data={}){
  if(!active)throw Error('Sessão encerrada.');
  const res=await fetcher('/api/v1/stores/'+store+'/print-device/'+op,{method:'POST',
   headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+token},
   body:JSON.stringify(data),cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',
   signal:AbortSignal.any([abort.signal,AbortSignal.timeout(8000)])});
  if(!active)throw Error('Sessão encerrada.');
  if([401,403,404].includes(res.status)){snapshot=null;emit('unauthorized');stop();throw Error('Sessão não autorizada.');}
  if(res.status===409){snapshot=null;emit('conflict');throw Error('Vínculo mudou ou há trabalhos pendentes. Atualize antes de tentar novamente.');}
  if(!res.ok)throw Error('Serviço Windows indisponível.');
  const body=await res.json();
  if(!active||!body?.data)throw Error('Resposta indisponível.');
  return body.data;
 }
 function enqueue(fn){
  const next=chain.then(async()=>{if(!active)throw Error('Sessão encerrada.');return fn();});
  chain=next.catch(()=>{});
  return next;
 }
 async function status(){
  const v=await post('status');
  if(!['connected','offline','not_detected'].includes(v.status)||
     !(v.bound_device_id===null||UUID.test(v.bound_device_id??''))||
     v.printer_computer_bound!==(v.bound_device_id!==null)||
     typeof v.bound_computer_connected!=='boolean')throw Error('Estado de vínculo inválido.');
  snapshot=v;emit(v.bound_device_id===device?'bound':v.bound_device_id?'other_device':'unbound');
  return v;
 }
 async function heartbeat(){
  const result=await post('ping',{device_id:device});
  if(result.received!==true)throw Error('Presença não confirmada.');
  return status();
 }
 async function poll(){
  try{
   await enqueue(async()=>{const v=await heartbeat();if(v.bound_device_id!==device)return;
    const result=await printClient.syncAndReconcile();if(active)emit('bound',{queue:result});
   });
  }catch{if(active){snapshot=null;emit('stale');}}
  finally{if(active&&started)timer=schedule(()=>{timer=null;void poll();},30000);}
 }
 function start(){if(started||!active)return;started=true;void poll();}
 function refresh(){return enqueue(status);}
 function sync(){return enqueue(async()=>{const v=await status();if(v.bound_device_id!==device)throw Error('Este computador não está vinculado.');return printClient.syncAndReconcile();});}
 function change(op,expected){
  if(expected!==null&&!UUID.test(expected??''))return Promise.reject(Error('Vínculo esperado inválido.'));
  return enqueue(async()=>{
   // Use the expected value from the explicit user confirmation; never
   // silently replace it with the current server value.
   if(snapshot===null||snapshot.bound_device_id!==expected)throw Error('Atualize o vínculo antes de confirmar.');
   if(op==='unbind'&&expected!==device)throw Error('Este computador não está vinculado.');
   const data=await post(op,{device_id:device,expected_device_id:expected});
   if(data[op==='switch'?'bound':'unbound']!==true)throw Error('Alteração não confirmada.');
   return status();
  });
 }
 return {start,stop,refresh,sync,switchDevice:expected=>change('switch',expected),unbind:expected=>change('unbind',expected)};
}
