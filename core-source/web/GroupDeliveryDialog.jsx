import React,{useEffect,useRef,useState} from 'react';
import {Bike,X} from 'lucide-react';
import {dispatchOptions,routeDestinationSummary,routeDestinationMessage} from './dispatchOptions.mjs';
import {sourceLabel} from './DeliveryDialog.jsx';
import {orderAddress,publicOrderNumber} from './orderDisplay.mjs';
export default function GroupDeliveryDialog({client,storeId,orders,deliveryIds,onClose,onSuccess}){
 const ref=useRef(),lock=useRef(false);
 const [data,setData]=useState(null),[courier,setCourier]=useState(''),[checked,setChecked]=useState(false),[busy,setBusy]=useState(true),[error,setError]=useState('');
 const load=async()=>{const results=await Promise.all([client.from('stores').select('id,max_orders_per_trip,latitude,longitude').eq('id',storeId).single(),client.rpc('pitacco_store_couriers',{p_store:storeId}),client.rpc('pitacco_store_courier_positions',{p_store:storeId}),client.from('deliveries').select('*').eq('store_id',storeId).not('status','in','(entregue,cancelada)')]);for(const result of results)if(result.error)throw result.error;return {store:results[0].data,couriers:results[1].data,positions:results[2].data,stops:results[3].data}};
 useEffect(()=>{const previous=document.activeElement;ref.current.showModal();let active=true;load().then(d=>active&&setData(d)).catch(e=>active&&setError(e.message)).finally(()=>active&&setBusy(false));return()=>{active=false;previous?.focus()}},[storeId]);
 const options=data?dispatchOptions({...data,manual:true}):[],choice=options.find(x=>x.c.id===courier),limit=data?.store?.max_orders_per_trip||1;
 const valid=orders.length>=2&&choice&&!choice.blocked&&checked;
 async function submit(){if(!valid||lock.current)return;lock.current=true;setBusy(true);setError('');try{
  const latest=await load(),next=dispatchOptions({...latest,manual:true}).find(x=>x.c.id===courier);
  if(!next||next.blocked)throw Error('A disponibilidade do entregador mudou.');
  if(next.jobs.map(d=>d.id).sort().join(',')!==choice.jobs.map(d=>d.id).sort().join(',')){setData(latest);setChecked(false);throw Error('A rota mudou. Confira os endereços novamente.');}
  const r=await client.rpc('assign_delivery_batch',{s:storeId,courier,delivery_ids:deliveryIds});if(r.error)throw r.error;
  if(!r.data)throw Error('Agrupamento não confirmado.');
  onSuccess(orders.length);
 }catch(e){setError(e.message||'Não foi possível agrupar os pedidos.')}finally{lock.current=false;setBusy(false)}}
 return <dialog className="delivery-dialog dispatch-only group-delivery-dialog" ref={ref} onCancel={e=>{e.preventDefault();if(!busy)onClose()}}>
 <div className="modal-heading"><span className="dispatch-icon"><Bike size={23}/></span><div className="dispatch-title"><h2>Agrupar pedidos</h2><span className="eyebrow">{orders.length} pedidos · Entrega própria</span></div><button className="secondary" disabled={busy} onClick={onClose} aria-label="Fechar"><X size={19}/></button></div>
 <div className="modal-body"><h3>Pedidos selecionados</h3>{orders.map((order,i)=><div className="group-delivery-stop" key={order.id}><b>#{publicOrderNumber(order)} · {sourceLabel(order.source)}</b><span>{order.receipt?.customer||'Cliente'}</span><small>{orderAddress(data?.stops.find(d=>d.id===deliveryIds[i])?.address||order.receipt?.address)||'Endereço a conferir'}</small></div>)}
 <h3>Selecionar entregador</h3>{data&&<p>Limite automático por viagem: {limit} pedidos</p>}{options.map(x=><label className="group-delivery-courier" key={x.c.id}><input type="radio" name="group-courier" disabled={busy||x.blocked} checked={courier===x.c.id} onChange={()=>{setCourier(x.c.id);setChecked(false)}}/><span><b>{x.c.name}</b><small>{!x.online?'Offline ou GPS desatualizado':x.inRoute?'Em entrega':x.jobs.length+orders.length>limit?'Acima do limite automático':x.jobs.length?'Em coleta':'Online'} · {x.jobs.length}/{limit} pedidos</small></span></label>)}
 {data&&!options.length&&<p>Nenhum entregador próprio disponível.</p>}
 {!!choice?.jobs.length&&<><h3>Pedidos já na rota</h3>{choice.jobs.map(d=><div className="group-delivery-stop" key={d.id}><b>{d.customer_name}</b><small>{orderAddress(d.address)}</small></div>)}</>}
 <p className="notice">{routeDestinationMessage(routeDestinationSummary([...deliveryIds.map(id=>data?.stops.find(d=>d.id===id)),...(choice?.jobs||[])]))}</p>
 {choice&&choice.jobs.length+orders.length>limit&&<p className="notice">O agrupamento excede o limite automático de {limit} pedidos. A loja decide se o entregador consegue transportar todos com segurança.</p>}
 <label className="group-delivery-courier"><input type="checkbox" checked={checked} disabled={!choice||busy} onChange={e=>setChecked(e.target.checked)}/><span>Conferi os endereços, os prazos e a capacidade de transporte.</span></label>
 {busy&&<p role="status">Atualizando informações…</p>}{error&&<p className="notice error" role="alert">{error}</p>}</div>
 <footer><button className="secondary" disabled={busy} onClick={onClose}>Cancelar</button><button className="dispatch-confirm" disabled={busy||!valid} onClick={submit}>Confirmar agrupamento</button></footer></dialog>
}
