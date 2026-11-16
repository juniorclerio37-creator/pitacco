import React, {useEffect,useRef,useState} from 'react';
import {invoke} from './printBridge.mjs';
import {mountDeliveryMap,currentLocation} from './deliveryMap.mjs';
import {storefrontLink} from './storefrontLink.mjs';

const origin=import.meta.env.VITE_PITACCO_HOMOLOGACAO==='1'
 ? import.meta.env.VITE_PITACCO_HOMOLOG_SITE_ORIGIN || window.location.origin
 : 'https://pitacco.com.br';
const methods={dinheiro:'Dinheiro',cartao_entrega:'Cartão na entrega',pix_manual:'Pix manual'};
const providers={mercado_pago:'Mercado Pago',pagbank:'PagBank (PagSeguro)',infinitepay:'InfinitePay'};
const initialArea=store=>({enabled:false,latitude:store.latitude??'',longitude:store.longitude??'',radius_m:3000});
const menuFields='slug,enabled,delivery_enabled,pickup_enabled,delivery_fee,payment_methods,pix_instructions';

export function useStorefrontMenu(client,storeId,userId,manager){
 const canRead=Boolean(client&&storeId&&userId);
 const [state,setState]=useState({}),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(!canRead||!storeId)return;
  let live=true;
  (async()=>{
   try{
    const result=manager
     ? await client.from('public_menu_settings').select(menuFields).eq('store_id',storeId).maybeSingle()
     : await client.rpc('pitacco_storefront_link',{p_store:storeId});
    if(result.error)throw result.error;
    if(live)setState({storeId,userId,manager,attempt,menu:result.data});
   }catch{
    if(live)setState({storeId,userId,manager,attempt,error:'Não foi possível carregar o cardápio da loja.'});
   }
  })();
  return()=>{live=false;};
 },[client,storeId,userId,manager,canRead,attempt]);
 return {
  ...(canRead&&state.storeId===storeId&&state.userId===userId&&state.manager===manager&&state.attempt===attempt?state:{}),
  reload:()=>setAttempt(value=>value+1),
  update:menu=>setState({storeId,userId,manager,attempt,menu}),
 };
}

export function StorefrontShare({menu,native}){
 const [notice,setNotice]=useState('');
 const link=storefrontLink(menu?.slug,origin);
 useEffect(()=>setNotice(''),[link,menu?.enabled]);
 if(!link)return null;
 async function copy(){
  try{
   await navigator.clipboard.writeText(link);
   setNotice('Link do cardápio copiado.');
  }catch{setNotice('Selecione o endereço para copiar.');}
 }
 return <div className="storefront-share">
  <span><strong>Cardápio digital</strong>{!menu.enabled&&<small> · Aguardando publicação</small>}</span>
  <a href={link} target="_blank" rel="noreferrer" onClick={native?event=>{
   event.preventDefault();
   invoke('open_storefront',{slug:menu.slug}).catch(()=>setNotice('Copie o link e abra no navegador.'));
  }:undefined}>{link}</a>
  <button type="button" className="secondary" onClick={copy}>Copiar link</button>
  {notice&&<small role="status">{notice}</small>}
 </div>;
}

export function StorefrontPayments({client,storeId,resource}){
 const {menu,error,reload,update}=resource;
 const [draft,setDraft]=useState(menu),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[failure,setFailure]=useState('');
 useEffect(()=>setDraft(menu),[menu]);
 const change=(name,value)=>setDraft(previous=>({...previous,[name]:value}));
 async function save(event){
  event.preventDefault();
  setBusy(true);setNotice('');setFailure('');
  try{
   const {error}=await client.rpc('save_public_menu_settings',{
    p_store:storeId,p_slug:draft.slug,p_enabled:draft.enabled,p_delivery_enabled:draft.delivery_enabled,
    p_pickup_enabled:draft.pickup_enabled,p_delivery_fee:Number(draft.delivery_fee),
    p_payment_methods:draft.payment_methods,p_pix_instructions:draft.pix_instructions,
   });
   if(error)throw error;
   update(draft);
   setNotice('Configurações do cardápio e formas de pagamento salvas.');
  }catch(failure){setFailure(failure.message||'Não foi possível salvar.');}
  finally{setBusy(false);}
 }
 return <>
  <section className="panel" aria-label="Pagamentos do cardápio">
   <h3>Cardápio e formas de pagamento</h3>
   {error&&<p role="alert">{error} <button type="button" onClick={reload}>Tentar novamente</button></p>}
   {menu===undefined&&!error&&<p role="status">Carregando configurações…</p>}
   {menu===null&&<p role="status">O endereço da loja está sendo preparado.</p>}
   {draft&&<form onSubmit={save}>
    <fieldset disabled={busy}>
     <legend>Atendimento e publicação</legend>
     <label><input type="checkbox" checked={draft.enabled} onChange={e=>change('enabled',e.target.checked)}/> Publicar cardápio</label>
     <label><input type="checkbox" checked={draft.delivery_enabled} onChange={e=>change('delivery_enabled',e.target.checked)}/> Aceitar entrega</label>
     <label><input type="checkbox" checked={draft.pickup_enabled} onChange={e=>change('pickup_enabled',e.target.checked)}/> Aceitar retirada</label>
     <label>Taxa de entrega (R$)<input required type="number" min="0" max="1000" step="0.01" value={draft.delivery_fee} onChange={e=>change('delivery_fee',e.target.value)}/></label>
    </fieldset>
    <fieldset disabled={busy}>
     <legend>Formas aceitas no checkout</legend>
     {Object.entries(methods).map(([method,label])=><label key={method}>
      <input type="checkbox" checked={draft.payment_methods.includes(method)} onChange={e=>change('payment_methods',
       e.target.checked?[...draft.payment_methods,method]:draft.payment_methods.filter(value=>value!==method))}/> {label}
     </label>)}
     {draft.payment_methods.includes('pix_manual')&&<label>Instruções do Pix manual
      <textarea required minLength={3} maxLength={1000} value={draft.pix_instructions} onChange={e=>change('pix_instructions',e.target.value)}/>
     </label>}
    </fieldset>
    {failure&&<p role="alert">{failure}</p>}
    {notice&&<p role="status">{notice}</p>}
    <button disabled={busy||!draft.payment_methods.length||(!draft.delivery_enabled&&!draft.pickup_enabled)}>
     {busy?'Salvando…':'Salvar cardápio e pagamentos'}
    </button>
   </form>}
  </section>
  <PaymentProviders client={client} storeId={storeId}/>
 </>;
}

export function StoreDeliveryArea({client,store}){
 const [area,setArea]=useState(()=>initialArea(store)),[state,setState]=useState('loading');
 const [reason,setReason]=useState(''),[notice,setNotice]=useState(''),[mapError,setMapError]=useState('');
 const [busy,setBusy]=useState(false),[locating,setLocating]=useState(false),[retry,setRetry]=useState(0),[showMap,setShowMap]=useState(false);
 const container=useRef(null),map=useRef(null),latest=useRef(area);
 latest.current=area;
 const change=(key,value)=>setArea(previous=>({...previous,[key]:value}));
 const choose=([latitude,longitude])=>setArea(previous=>({...previous,latitude,longitude}));
 useEffect(()=>{
  let live=true;
  (async()=>{
   try{
    const {data,error}=await client.from('pitacco_store_delivery_areas').select('enabled,latitude,longitude,radius_m').eq('store_id',store.id).maybeSingle();
    if(error)throw error;
    if(live){setArea(data||initialArea(store));setState('ready');}
   }catch(failure){if(live){setReason(failure.message||'Não foi possível carregar a área.');setState('error');}}
  })();
  return()=>{live=false;};
 },[client,store.id,retry]);
 const point=area.latitude!==''&&area.longitude!==''&&Math.abs(Number(area.latitude))<=85&&Math.abs(Number(area.longitude))<=180
  ?[Number(area.latitude),Number(area.longitude)]:null;
 const pointKey=point?.join(',')||'';
 useEffect(()=>{
  if(state!=='ready'||!showMap)return;
  let live=true;
  const saved=latest.current;
  const center=saved.latitude!==''&&saved.longitude!==''?[Number(saved.latitude),Number(saved.longitude)]:null;
  mountDeliveryMap(container.current,{center,radius:Number(saved.radius_m),onSelect:choose}).then(result=>{
   if(!live){result?.remove();return;}
   map.current=result;
   const current=latest.current;
   if(current.latitude!==''&&current.longitude!==''){
    result?.setArea([Number(current.latitude),Number(current.longitude)],Number(current.radius_m),true);
   }
  }).catch(failure=>{
   if(live){setMapError(failure.message);setShowMap(false);}
  });
  return()=>{live=false;map.current?.remove();map.current=null;};
 },[state,showMap]);
 useEffect(()=>{
  const center=pointKey?pointKey.split(',').map(Number):null;
  map.current?.setArea(center,Number(area.radius_m));
 },[pointKey,area.radius_m]);
 async function locate(){
  setLocating(true);setNotice('');setReason('');
  try{
   const center=await currentLocation();
   choose(center);
   if(map.current){map.current.showPoint(center);map.current.setArea(center,Number(area.radius_m),true);}
   else {setMapError('');setShowMap(true);}
  }catch(failure){setReason(failure.message);}
  finally{setLocating(false);}
 }
 async function save(event){
  event.preventDefault();setBusy(true);setReason('');setNotice('');
  try{
   const {error}=await client.from('pitacco_store_delivery_areas').upsert({
    store_id:store.id,enabled:area.enabled,latitude:point[0],longitude:point[1],radius_m:Number(area.radius_m)
   },{onConflict:'store_id'});
   if(error)throw error;
   setNotice(area.enabled?'Área de entrega ativa.':'Limite de área desativado.');
  }catch(failure){setReason(failure.message||'Não foi possível salvar a área.');}
  finally{setBusy(false);}
 }
 return <section className="panel" aria-label="Área de entrega">
  <h3>Área de entrega</h3>
  <p>Marque o centro da área no mapa e defina a distância em linha reta. Se ativar o limite, a loja só receberá pelo cardápio pedidos de entrega com um ponto dentro dessa área.</p>
  {state==='loading'&&<p role="status">Carregando área de entrega…</p>}
  {reason&&<p role="alert">{reason}</p>}
  {notice&&<p role="status">{notice}</p>}
  {state==='error'&&<button type="button" onClick={()=>{setState('loading');setReason('');setRetry(value=>value+1);}}>Tentar novamente</button>}
  {state==='ready'&&<form onSubmit={save}>
   <fieldset disabled={busy}>
    <legend>Limite da loja</legend>
    <label><input type="checkbox" checked={area.enabled} onChange={e=>change('enabled',e.target.checked)}/> Ativar limite de entrega</label>
    <div className="storefront-map-actions">
     <button type="button" className="secondary" onClick={()=>{setMapError('');setShowMap(value=>!value);}}>{showMap?'Ocultar mapa':'Abrir mapa'}</button>
     <button type="button" className="secondary" disabled={locating} onClick={locate}>{locating?'Localizando…':'Usar minha localização'}</button>
    </div>
    {showMap&&<div ref={container} className="storefront-map" aria-label="Mapa para marcar o centro da área de entrega"/>}
    {mapError&&<p role="status">{mapError} Você também pode informar as coordenadas.</p>}
    <div className="storefront-area-inputs">
     <label>Latitude do centro<input required type="number" min="-85" max="85" step="any" value={area.latitude} onChange={e=>change('latitude',e.target.value)}/></label>
     <label>Longitude do centro<input required type="number" min="-180" max="180" step="any" value={area.longitude} onChange={e=>change('longitude',e.target.value)}/></label>
     <label>Raio da área (metros)<input required type="number" min="100" max="100000" step="1" value={area.radius_m} onChange={e=>change('radius_m',e.target.value)}/></label>
    </div>
   </fieldset>
   <button disabled={busy||!point}>{busy?'Salvando…':'Salvar área de entrega'}</button>
  </form>}
 </section>;
}

function PaymentProviders({client,storeId}){
 const [choices,setChoices]=useState(null),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0);
 const [failure,setFailure]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{
  let live=true;
  (async()=>{
   try{
    const {data,error}=await client.from('pitacco_store_payment_providers').select('provider,requested_enabled').eq('store_id',storeId);
    if(error)throw error;
    if(live)setChoices(Object.fromEntries(data.map(row=>[row.provider,row.requested_enabled])));
   }catch(error){if(live)setFailure(error.message||'Não foi possível carregar as integrações.');}
  })();
  return()=>{live=false;};
 },[client,storeId,attempt]);
 async function save(event){
  event.preventDefault();setBusy(true);setFailure('');setNotice('');
  try{
   const rows=Object.keys(providers).map(provider=>({store_id:storeId,provider,requested_enabled:!!choices[provider]}));
   const {error}=await client.from('pitacco_store_payment_providers').upsert(rows,{onConflict:'store_id,provider'});
   if(error)throw error;
   setNotice('Preferências de integração salvas.');
  }catch(error){setFailure(error.message||'Não foi possível salvar as opções.');}
  finally{setBusy(false);}
 }
 return <section className="panel" aria-label="Integrações de pagamento">
  <h3>Integrações de pagamento online</h3>
  <p>Escolha quais provedores a loja quer usar. A disponibilidade no checkout depende da integração e da homologação pelo Pitacco.</p>
  {failure&&<p role="alert">{failure}</p>}
  {notice&&<p role="status">{notice}</p>}
  {choices===null&&(failure
   ?<button type="button" onClick={()=>{setFailure('');setAttempt(value=>value+1);}}>Tentar novamente</button>
   :<p role="status">Carregando provedores…</p>)}
  {choices!==null&&<form onSubmit={save}>
   <fieldset disabled={busy}>
    <legend>Provedores da loja</legend>
    {Object.entries(providers).map(([provider,label])=><label key={provider}>
     <input type="checkbox" checked={!!choices[provider]} onChange={e=>setChoices({...choices,[provider]:e.target.checked})}/> {label}
    </label>)}
   </fieldset>
   <button disabled={busy}>{busy?'Salvando…':'Salvar preferências de integração'}</button>
  </form>}
 </section>;
}
