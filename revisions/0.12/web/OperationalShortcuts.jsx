import React,{useEffect,useState,useRef} from 'react';
import {Plus,CheckCircle,Bike,Printer} from 'lucide-react';
const origins=['proprio','ifood','99food','keeta'];
export default function OperationalShortcuts({client,storeId,native,collapsed,onExpand,canCreate,canAccept,canDispatch,onNewOrder}){
 const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),alive=useRef(true);
 async function read(){
  const [a,b,c]=await Promise.all([
   canAccept?client.from('acceptance_settings').select('source,mode,enabled').eq('store_id',storeId):Promise.resolve({data:[]}),
   canDispatch?client.from('stores').select('dispatch_mode,max_orders_per_trip').eq('id',storeId).single():Promise.resolve({data:null}),
   native?client.rpc('pitacco_auto_print_status',{p_store:storeId}):Promise.resolve({data:null})
  ]);
  if(a.error)throw a.error;if(b.error)throw b.error;
  if(alive.current)setData({sources:(a.data||[]).filter(r=>r.enabled&&origins.includes(r.source)),store:b.data,print:c.error?null:c.data});
 }
 useEffect(()=>{alive.current=true;let running=false;async function tick(){if(running||lock.current)return;running=true;try{await read();if(alive.current)setError('')}catch(e){if(alive.current)setError(e.message||String(e))}finally{running=false}}void tick();const timer=setInterval(tick,5000);return()=>{alive.current=false;clearInterval(timer)}},[client,storeId,native,canAccept,canDispatch]);
 async function change(action){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await action();await read()}catch(e){if(alive.current)setError(e.message||String(e))}finally{lock.current=false;if(alive.current)setBusy(false)}}
 const enabled=data?.sources||[], all=enabled.length>0&&enabled.every(r=>r.mode==='automatic'),mixed=!all&&enabled.some(r=>r.mode==='automatic');
 const dispatch=data?.store?.dispatch_mode,autoDispatch=['automatico','misto'].includes(dispatch);
 const toggle=(Icon,label,checked,disabled,click,note)=> <button type="button" className="mn-op-toggle" role="switch" aria-label={label} aria-checked={checked} disabled={disabled||busy} title={note||label} onClick={click}><Icon size={16}/><span>{label}{note&&<small>{note}</small>}</span><i className={checked?'on':''} aria-hidden="true"/></button>;
 return <section className="mn-operations" aria-label="Controle operacional">
 {canCreate&&<button type="button" className="mn-new-order" title="Novo Pedido" onClick={()=>{if(collapsed)onExpand();onNewOrder()}}><Plus size={20}/><span>Novo Pedido</span></button>}
 {!collapsed&&<>
 <small className="mn-op-heading">Controle operacional</small>
 {canAccept&&toggle(CheckCircle,'Aceite automático',all,!data||!enabled.length,()=>change(async()=>{const {error}=await client.from('acceptance_settings').upsert(enabled.map(r=>({store_id:storeId,source:r.source,enabled:true,mode:all?'manual':'automatic'})),{onConflict:'store_id,source'});if(error)throw error}),mixed?'Parcial · origens habilitadas':data&&!enabled.length?'Configure as origens':null)}
 {canDispatch&&toggle(Bike,'Alocação automática',autoDispatch,!data?.store,()=>change(async()=>{const {data:latest,error:readError}=await client.from('stores').select('dispatch_mode,max_orders_per_trip').eq('id',storeId).single();if(readError)throw readError;const {error}=await client.rpc('set_dispatch_policy',{s:storeId,dispatch:['automatico','misto'].includes(latest.dispatch_mode)?'manual':'automatico',max_orders:latest.max_orders_per_trip||1});if(error)throw error}),dispatch==='misto'?'Modo misto':null)}
 {native&&toggle(Printer,'Impressão automática',data?.print===true,typeof data?.print!=='boolean',()=>change(async()=>{const {error}=await client.rpc('pitacco_set_auto_print',{p_store:storeId,p_enabled:!data.print});if(error)throw error}),data?.print==null?'Configuração indisponível':null)}
 {error&&<small role="alert" className="mn-op-error">{error}</small>}
 </>}
 </section>
}
