// Experimental same-origin print transport, no automatic fallback or hardware access.
// The host supplies the existing native bridge. Server IDs remain authoritative.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const states=new Set(['claimed','saved','uncertain','error']);
export function createWindowsPrintClient({store,device,token,fetcher=globalThis.fetch,nativeCall,ingestJobs,storeName,client,storeLogoPath}){
 if(!UUID.test(store??'')||!UUID.test(device??'')||typeof token!=='string'||!token||typeof nativeCall!=='function'||typeof ingestJobs!=='function')throw new TypeError('Sessão de impressão inválida.');
 let active=true,flight=null,abort=new AbortController();
 async function post(op,data={}){
  if(!active)throw Error('Sessão encerrada.');
  const res=await fetcher('/api/v1/stores/'+store+'/own-print/'+op,{
   method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+token},
   body:JSON.stringify({device_id:device,...data}),cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',
   signal:AbortSignal.any([abort.signal,AbortSignal.timeout(8000)])});
  if(!active)throw Error('Sessão encerrada.');
  if([401,403,404].includes(res.status)){stop();throw Error('Impressão não autorizada.');}
  if(!res.ok)throw Error('Fila indisponível.');
  const body=await res.json();
  if(!active||!body?.data)throw Error('Fila indisponível.');
  return body.data;
 }
 function stop(){active=false;token='';abort.abort();}
 async function ack({p_job,p_device,p_state,p_error}){
  if(p_device!==device||!UUID.test(p_job??'')||!['saved','submitted','uncertain','error'].includes(p_state))throw Error('Confirmação inválida.');
  const data=await post('ack',{job_id:p_job,state:p_state,error:p_error==null?null:String(p_error).slice(0,240)});
  if(data.acknowledged!==true)throw Error('Confirmação pendente.');
 }
 function sync(){
  if(flight)return flight;
  flight=(async()=>{
   const {jobs}=await post('claim');
   if(!Array.isArray(jobs)||jobs.length>100||new Set(jobs.map(j=>j?.id)).size!==jobs.length||
    jobs.some(j=>!UUID.test(j?.id??'')||j.store_id!==store||!UUID.test(j.order_id??'')||
     !states.has(j.state)||![58,80].includes(j.width)||typeof j.printer!=='string'||!j.printer||j.receipt?.source!=='proprio'))
    throw Error('Lote de impressão inválido.');
   const eligible=[],manual=[];
   for(const job of jobs){
    if(!active)throw Error('Sessão encerrada.');
    if(job.state==='claimed'){eligible.push(job);continue;}
    // Never recreate a missing local record for a possibly printed job.
    const saved=await nativeCall('has_saved_print_job',{id:job.id,storeId:store,printer:job.printer,width:job.width});
    if(saved===true&&job.state==='saved')eligible.push(job);
    else if(saved!==true)manual.push(job.id);
   }
   if(!active)throw Error('Sessão encerrada.');
   await ingestJobs({jobs:eligible,device,call:(...args)=>{
    if(!active)throw Error('Sessão encerrada.');return nativeCall(...args);
   },ack,storeName,client,storeLogoPath});
   return {eligible:eligible.length,manual};
  })().finally(()=>{flight=null;});
  return flight;
 }
 return {async bind(){const result=await post('bind');if(result.bound!==true)throw Error('Vínculo pendente.');return true;},sync,ack,stop};
}
