import React, {useEffect,useRef,useState} from 'react';
import {invoke} from './printBridge.mjs';
import {mountDeliveryMap} from './deliveryMap.mjs';
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
 const address=[store.address,store.address_number,store.neighborhood,store.city,store.state,store.postal_code].filter(Boolean).join(', ');
 const [center,setCenter]=useState(()=>Number.isFinite(Number(store.latitude))&&Number.isFinite(Number(store.longitude))&&store.latitude!=null&&store.longitude!=null?[Number(store.latitude),Number(store.longitude)]:null);
 const centerKey=center?.join(',')||'';
 const [radius,setRadius]=useState(5),[rates,setRates]=useState(Array(10).fill(0)),[neighborhoods,setNeighborhoods]=useState([]);
 const [status,setStatus]=useState('loading'),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false),[locating,setLocating]=useState(false),[showMap,setShowMap]=useState(false);
 const container=useRef(null),map=useRef(null);
 useEffect(()=>{
  let live=true;
  setStatus('loading');setError('');
  client.from('pitacco_delivery_pricing').select('max_radius_km,distance_fees,neighborhood_fees,enabled').eq('store_id',store.id).maybeSingle().then(({data,error})=>{
   if(!live)return;
   if(error){setError(error.message);setStatus('error');return;}
   setRadius(data?.max_radius_km||5);
   setRates(Array.isArray(data?.distance_fees)&&data.distance_fees.length===10?data.distance_fees:Array(10).fill(0));
   setNeighborhoods(Array.isArray(data?.neighborhood_fees)?data.neighborhood_fees:[]);
   setStatus('ready');
  });
  return()=>{live=false;};
 },[client,store.id]);
 useEffect(()=>{
  if(!showMap||!container.current||!center)return;
  let live=true;
  mountDeliveryMap(container.current,{center,radius:radius*1000,onSelect:()=>{}}).then(result=>{
   if(live){map.current=result;result?.setArea(center,radius*1000,true)}
   else result?.remove();
  }).catch(e=>{if(live)setError('Não foi possível carregar o mapa: '+e.message)});
  return()=>{live=false;map.current?.remove();map.current=null};
 },[showMap,store.id,centerKey]);
 useEffect(()=>{if(map.current&&center)map.current.setArea(center,radius*1000,true)},[radius,store.id,centerKey]);
 const validAddress=Boolean(store.address?.trim()&&store.city?.trim()&&store.state?.trim());
 const setFee=(index,value)=>setRates(previous=>previous.map((fee,i)=>i===index?value:fee));
 const setNeighborhood=(index,key,value)=>setNeighborhoods(previous=>previous.map((row,i)=>i===index?{...row,[key]:value}:row));
 async function resolveOrigin(){
  setLocating(true);setError('');setNotice('');
  try{
   if(!validAddress)throw Error('Cadastre a rua, cidade e o estado em Dados da loja.');
   const {data,error}=await client.functions.invoke('delivery-quote',{body:{action:'store-origin',store_id:store.id}});
   if(error)throw error;
   if(!Number.isFinite(data?.latitude)||!Number.isFinite(data?.longitude))throw Error(data?.error||'O endereço não pôde ser validado.');
   setCenter([data.latitude,data.longitude]);setShowMap(true);
   setNotice('Endereço validado. O ponto de partida foi atualizado automaticamente.');
  }catch(failure){setError('Falha ao validar endereço: '+(failure.message||String(failure)));}
  finally{setLocating(false);}
 }
 async function save(event){
  event.preventDefault();setBusy(true);setError('');setNotice('');
  try{
   if(!validAddress)throw Error('Complete a rua, cidade e estado em Dados da loja.');
   const fees=rates.map(value=>Number(value));
   if(fees.some(value=>!Number.isFinite(value)||value<0||value>999.99))throw Error('Corrija as taxas por distância.');
   const rows=neighborhoods.map(row=>({bairro:String(row.bairro||'').trim(),cidade:String(row.cidade||'').trim(),taxa:Number(row.taxa)}));
   const {data,error}=await client.rpc('pitacco_save_delivery_pricing',{p_store:store.id,p_radius:radius,p_distance:fees,p_neighborhoods:rows});
   if(error)throw error;
   if(!data?.saved)throw Error('O servidor não confirmou a gravação.');
   setNotice('Configurações salvas como rascunho. A ativação do frete automático exige um provedor de rotas homologado.');
  }catch(failure){setError(failure.message||'Não foi possível salvar as regras de entrega.');}
  finally{setBusy(false);}
 }
 return <section className="panel" aria-label="Área de entrega">
  <h3>Administrar Loja · Área de Entrega</h3>
  <p>O endereço cadastrado da loja é a origem das entregas. Configure o raio e as taxas por quilômetro ou bairro, sem informar latitude e longitude.</p>
  <div className="panel" style={{marginBottom:12}}>
   <strong>Endereço de partida</strong>
   <p>{address||'Endereço não cadastrado.'}</p>
   <p><a href={'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(address)} target="_blank" rel="noreferrer">Conferir endereço no Google Maps</a> · Para corrigir, acesse Dados da loja.</p>
   <button type="button" className="secondary" disabled={locating||!validAddress} onClick={resolveOrigin}>{locating?'Validando endereço…':'Validar endereço e centralizar mapa'}</button>
  </div>
  {!validAddress&&<p role="alert">Cadastre rua, cidade e estado em Dados da loja antes de salvar.</p>}
  {status==='loading'&&<p role="status">Carregando regras de entrega…</p>}
  {error&&<p role="alert">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  {status==='error'&&<button type="button" onClick={()=>{setError('');setStatus('loading');client.from('pitacco_delivery_pricing').select('*').eq('store_id',store.id).maybeSingle().then(({data,error})=>{if(error){setError(error.message);setStatus('error')}else{setRadius(data?.max_radius_km||5);setRates(data?.distance_fees||Array(10).fill(0));setNeighborhoods(data?.neighborhood_fees||[]);setStatus('ready')}})}}>Tentar novamente</button>}
  {status==='ready'&&<form onSubmit={save}>
   <fieldset disabled={busy}>
    <legend>Raio máximo de atendimento</legend>
    <label>Distância máxima
     <select value={radius} onChange={e=>setRadius(Number(e.target.value))}>
      {Array.from({length:10},(_,i)=>i+1).map(km=><option value={km} key={km}>{km} km</option>)}
     </select>
    </label>
    {center?<div className="storefront-map-actions"><button type="button" className="secondary" onClick={()=>setShowMap(value=>!value)}>{showMap?'Ocultar mapa':'Visualizar raio no mapa'}</button></div>
     :<p>O endereço cadastrado ainda não tem localização validada para desenhar o raio. As taxas podem ser salvas como rascunho.</p>}
    {showMap&&center&&<div ref={container} className="storefront-map" aria-label="Mapa do raio de atendimento a partir da loja"/>}
    <small>O círculo é uma referência visual em linha reta. A cobrança definitiva deverá utilizar quilômetros de trajeto viário validados no servidor.</small>
   </fieldset>
   <fieldset disabled={busy}>
    <legend>Taxas por distância de trajeto</legend>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(135px,1fr))',gap:12}}>
     {rates.slice(0,radius).map((fee,index)=><label key={index}>Até {index+1} km (R$)
      <input type="number" required min="0" max="999.99" step="0.01" value={fee} onChange={e=>setFee(index,e.target.value)}/>
     </label>)}
    </div>
   </fieldset>
   <fieldset disabled={busy}>
    <legend>Taxas especiais por bairro</legend>
    <p>Quando um bairro cadastrado estiver dentro do raio máximo, sua taxa prevalecerá sobre a faixa de quilômetros.</p>
    {neighborhoods.map((entry,i)=><div key={i} style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:9,alignItems:'end'}}>
     <label>Bairro<input required maxLength={80} value={entry.bairro||''} onChange={e=>setNeighborhood(i,'bairro',e.target.value)}/></label>
     <label>Cidade<input required maxLength={80} value={entry.cidade||''} onChange={e=>setNeighborhood(i,'cidade',e.target.value)}/></label>
     <label>Taxa (R$)<input required type="number" min="0" max="999.99" step="0.01" value={entry.taxa} onChange={e=>setNeighborhood(i,'taxa',e.target.value)}/></label>
     <button type="button" className="secondary" onClick={()=>setNeighborhoods(rows=>rows.filter((_,j)=>j!==i))}>Remover bairro</button>
    </div>)}
    <button type="button" className="secondary" disabled={neighborhoods.length>=100} onClick={()=>setNeighborhoods(rows=>[...rows,{bairro:'',cidade:store.city||'',taxa:0}])}>Adicionar bairro</button>
   </fieldset>
   <p>As regras permanecem como <strong>rascunho</strong> até que geocodificação e rotas estejam homologadas. As entregas existentes continuam usando a configuração anterior; nenhum valor novo será cobrado indevidamente.</p>
   <button disabled={busy||!validAddress}>{busy?'Salvando…':'Salvar regras de entrega'}</button>
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
