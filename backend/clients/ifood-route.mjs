import {ifoodDispatchOutcome} from '../../entregador/ifood-departure.mjs';
// Explicit driver operation only. The legacy driverAction must remain
// authenticated and independently enforce its original dispatch lease.
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function createIfoodRoute({actor,token,legacyClient,driverAction,fetcher=globalThis.fetch}){
 if(!UUID.test(actor??'')||typeof token!=='string'||!token||typeof legacyClient?.auth?.getUser!=='function'||typeof driverAction!=='function')throw new TypeError('Sessão do entregador inválida.');
 let active=true,busy=false;
 const abort=new AbortController(),attempted=new Map();
 function stop(){active=false;token='';abort.abort();attempted.clear();}
 async function identity(){
  if(!active)throw Error('Sessão encerrada.');
  const {data,error}=await legacyClient.auth.getUser();
  if(!active)throw Error('Sessão encerrada.');
  if(error||data?.user?.id!==actor)throw Error('Sessão original não corresponde ao entregador.');
 }
 async function core(body){
  if(!active)throw Error('Sessão encerrada.');
  const res=await fetcher('/api/v1/courier/ifood-route',{method:'POST',headers:{
   Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+token
  },body:JSON.stringify(body),cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',
   signal:AbortSignal.any([abort.signal,AbortSignal.timeout(10000)])});
  if(!active)throw Error('Sessão encerrada.');
  if([401,403,404].includes(res.status)){stop();throw Error('Rota não autorizada.');}
  if(!res.ok)throw Error('Operação local não confirmada. Atualize a rota.');
  const out=await res.json();if(!active||!out?.data)throw Error('Operação local não confirmada.');
  return out.data;
 }
 async function run(fn){
  if(!active)throw Error('Sessão encerrada.');
  if(busy)throw Error('Operação já em andamento.');
  busy=true;try{return await fn();}finally{busy=false;}
 }
 function collect(delivery){
  return run(async()=>{if(!UUID.test(delivery??''))throw Error('Entrega inválida.');
   const data=await core({action:'collect',delivery_id:delivery});
   if(data.collected!==true)throw Error('Coleta não confirmada.');
   return {collected:true};
  });
 }
 function depart(route){
  return run(async()=>{
   if(!UUID.test(route??''))throw Error('Rota inválida.');
   // Do not start a new mixed route with no matching legacy session.
   await identity();
   const data=await core({action:'depart_group',route_id:route});
   const ids=data.pending_ifood_dispatch;
   if(data.departed!==true||!Array.isArray(ids)||ids.length>15||ids.some(id=>!UUID.test(id??''))||
    new Set(ids.map(id=>id.toLowerCase())).size!==ids.length)throw Error('Saída não confirmada ou lista inválida. Atualize a rota.');
   const outcomes=[];
   for(const id of ids){
    const key=id.toLowerCase();
    if(!active)throw Error('Sessão encerrada.');
    if(attempted.has(key)){outcomes.push({id,state:attempted.get(key)});continue;}
    try{await identity();}catch{if(!active)throw Error('Sessão encerrada.');outcomes.push({id,state:'pending'});continue;}
    attempted.set(key,'uncertain');
    let state='uncertain';
    try{
     const result=await driverAction(id,'dispatch');
     if(!active)throw Error('Sessão encerrada.');
     state=result?.provider_state==='uncertain'?'uncertain':ifoodDispatchOutcome(result);
    }catch(err){
     if(!active)throw Error('Sessão encerrada.');
     // No provider message, external ID or token is retained in the result.
     state=err?.providerState==='rejected'?'rejected':'uncertain';
    }
    attempted.set(key,state);
    outcomes.push({id,state});
   }
   return {departed:true,outcomes};
  });
 }
 return {collect,depart,stop};
}
