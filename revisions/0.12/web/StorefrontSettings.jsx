import React, {useEffect,useRef,useState} from 'react';
import {invoke} from './printBridge.mjs';
import {mountDeliveryCoverageMap} from './deliveryMap.mjs';
import {shopPoint,locateStoreByAddress} from './mapOrigin.mjs';
import {storefrontLink} from './storefrontLink.mjs';

const origin=import.meta.env.VITE_PITACCO_HOMOLOGACAO==='1'
 ? import.meta.env.VITE_PITACCO_HOMOLOG_SITE_ORIGIN || window.location.origin
 : 'https://pitacco.com.br';
const methods={dinheiro:'Dinheiro',cartao_entrega:'Cartão na entrega',pix_manual:'Pix manual'};
const providers={mercado_pago:'Mercado Pago',pagbank:'PagBank (PagSeguro)',infinitepay:'InfinitePay'};
const menuFields='slug,enabled,delivery_enabled,pickup_enabled,payment_methods,pix_instructions';

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
    p_pickup_enabled:draft.pickup_enabled,p_delivery_fee:0,
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
     <p className="storefront-delivery-note">Os valores de frete são definidos exclusivamente em <strong>Administrar Loja → Área de Entrega</strong>, não nas formas de pagamento.</p>
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
 const [automaticPoint,setAutomaticPoint]=useState(null);
 const [locationState,setLocationState]=useState('idle');
 const [locationRetry,setLocationRetry]=useState(0);
 const [locationMessage,setLocationMessage]=useState('');
 const locationAttempts=useRef(null);
 const savedPoint=shopPoint(store);
 // Never use a geocoder's street-level suggestion as the freight origin.
 // Exact geocoding is persisted by the server; unverified results only
 // appear in Dados e identidade for manual confirmation.
 const origin=savedPoint||(automaticPoint?.storeId===store.id&&!automaticPoint.approximate?automaticPoint.point:null);
 const address=[store.address,store.address_number,store.neighborhood,
   store.city,store.state,store.postal_code].filter(Boolean).join(', ');
 const [mode,setMode]=useState('circle');
 const [radius,setRadius]=useState(5);
 const [rates,setRates]=useState(Array(10).fill(0));
 const [polygon,setPolygon]=useState([]);
 const [polygonFee,setPolygonFee]=useState(0);
 const [status,setStatus]=useState('loading');
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false);
 const [enabled,setEnabled]=useState(false);
 const [revision,setRevision]=useState(0);
 const [reloadAreas,setReloadAreas]=useState(0);
 const container=useRef(null),map=useRef(null);
 // Keep the latest selection while Leaflet loads asynchronously on mobile.
 const liveMapOptions=useRef({mode,radius,polygon});
 liveMapOptions.current={mode,radius,polygon};
 // Opening Áreas de Entrega must resolve the merchant's SAVED street address.
 // It must not require manually visiting another tab or filling coordinates.
 useEffect(()=>{
  if(savedPoint||!store?.id)return;
  if(!store.address?.trim()||!store.city?.trim()||!store.state?.trim()){
   setLocationMessage('Cadastre rua, cidade e estado em Dados e identidade.');
   return;
  }
  const key=[store.id,store.address,store.address_number,store.neighborhood,
   store.city,store.state,store.postal_code].map(x=>String(x||'').trim()).join('|');
  if(locationAttempts.current===key)return;
  locationAttempts.current=key;
  let alive=true;
  setLocationState('loading');
  setLocationMessage('Localizando a loja automaticamente pelo endereço cadastrado…');
  locateStoreByAddress(client,store.id).then(({point,approximate})=>{
   if(!alive)return;
   setAutomaticPoint({storeId:store.id,point,approximate});
   setLocationState('ready');
   setLocationMessage(approximate
    ?'Endereço encontrado apenas de forma aproximada. Confirme a entrada da loja em Dados e identidade antes de configurar o frete.'
    :'Loja localizada automaticamente pelo endereço cadastrado.');
  }).catch(error=>{
   if(!alive)return;
   setLocationState('error');
   setLocationMessage('Não conseguimos localizar a loja automaticamente: '+(error.message||String(error))+
    '. O mapa continua disponível e você pode marcar a entrada em Dados e identidade.');
  });
  return()=>{alive=false;};
 },[client,store?.id,store?.address,store?.address_number,store?.neighborhood,
   store?.city,store?.state,store?.postal_code,savedPoint?.[0],savedPoint?.[1],locationRetry]);
 function retryLocation(){locationAttempts.current=null;setLocationState('idle');setAutomaticPoint(null);
  setLocationMessage('');setLocationRetry(n=>n+1);}
 useEffect(()=>{
  let live=true;
  setStatus('loading');setError('');
  (async()=>{
   try{
    const {data,error}=await client.from('pitacco_delivery_pricing')
     .select('coverage_type,max_radius_km,distance_fees,polygon,polygon_fee,enabled')
     .eq('store_id',store.id).maybeSingle();
    if(error)throw error;
    if(!live)return;
    setMode(data?.coverage_type==='polygon'?'polygon':'circle');
    setRadius(data?.max_radius_km||5);
    setRates(Array.isArray(data?.distance_fees)&&data.distance_fees.length===10
      ?data.distance_fees.map(Number):Array(10).fill(0));
    setPolygon(Array.isArray(data?.polygon)?data.polygon:[]);
    setPolygonFee(Number(data?.polygon_fee||0));
    setEnabled(Boolean(data?.enabled));
    setRevision(n=>n+1);
    setStatus('ready');
   }catch(failure){
    if(live){setError(failure.message||'Não foi possível carregar as áreas.');setStatus('error');}
   }
  })();
  return()=>{live=false};
 },[client,store.id,reloadAreas]);
 useEffect(()=>{
  if(status!=='ready'||!container.current)return;
  let alive=true;
  mountDeliveryCoverageMap(container.current,{
   center:origin,mode,radiusKm:radius,vertices:polygon,
   onVerticesChange:next=>{if(alive){setPolygon(next);setNotice('');}}
  }).then(instance=>{
    if(!alive){instance.remove();return;}
    map.current=instance;
    // A radio click may occur before the Leaflet bundle finishes loading.
    const latest=liveMapOptions.current;
    instance.setMode(latest.mode);
    instance.setRadius(latest.radius);
    instance.setVertices(latest.polygon);
    instance.resize();
  }).catch(failure=>{if(alive)setError('Mapa indisponível: '+failure.message)});
  return()=>{alive=false;map.current?.remove();map.current=null};
 },[store.id,status,origin?.[0],origin?.[1],revision]);
 useEffect(()=>map.current?.setMode(mode),[mode]);
 useEffect(()=>map.current?.setRadius(radius),[radius]);
 function undoVertex(){setPolygon(previous=>{
  const next=previous.slice(0,-1);map.current?.setVertices(next);return next;
 })}
 function clearVertices(){setPolygon([]);map.current?.setVertices([]);}
 function setFee(index,value){setRates(previous=>previous.map((v,i)=>i===index?value:v))}
 async function save(event){
  event.preventDefault();setBusy(true);setError('');setNotice('');
  try{
   if(!origin)throw Error('Marque primeiro a entrada da loja em Dados e identidade.');
   if(!address)throw Error('Cadastre o endereço completo da loja.');
   if(mode==='polygon'&&polygon.length<3)
    throw Error('Desenhe pelo menos três pontos para fechar o polígono.');
   const fees=rates.map(Number),flat=Number(polygonFee);
   if(fees.some(value=>!Number.isFinite(value)||value<0||value>999.99)||
      !Number.isFinite(flat)||flat<0||flat>999.99)
    throw Error('Confira os valores de entrega.');
   const {data,error}=await client.rpc('pitacco_save_delivery_zone',{
    p_store:store.id,p_mode:mode,p_radius:radius,p_distance:fees,
    p_polygon:mode==='polygon'?polygon:[],p_polygon_fee:flat,
   });
   if(error)throw error;
   if(!data?.saved||!data?.enabled)throw Error('A configuração não foi confirmada.');
   setEnabled(true);
   setNotice('Área e valores de entrega salvos. O cardápio calculará o frete exclusivamente pelas regras desta tela.');
  }catch(failure){setError(failure.message||'Não foi possível salvar a área de entrega.');}
  finally{setBusy(false)}
 }
 return <section className="panel" aria-label="Área de entrega">
  <h3>Administrar Loja · Área de Entrega</h3>
  <p>Defina no mapa exatamente onde sua loja entrega. O frete do cardápio usa somente os limites e preços escolhidos aqui.</p>
  <p><strong>Loja:</strong> {address||'Cadastre o endereço em Dados e identidade.'}</p>
  {!origin&&<p role="status">Aguardando a localização da loja pelo endereço cadastrado. Você já pode escolher círculo ou polígono; será possível salvar assim que o marcador estiver localizado.</p>}
  {locationMessage&&<p role="status" className="storefront-delivery-note">{locationMessage}</p>}
  {locationState==='error'&&<button type="button" className="secondary" onClick={retryLocation}>Tentar localizar novamente</button>}
  {status==='loading'&&<p role="status">Carregando área de entrega…</p>}
  {status==='error'&&<button type="button" onClick={()=>setReloadAreas(n=>n+1)}>Tentar novamente</button>}
  {status==='ready'&&<form onSubmit={save} className="delivery-zone-config">
   <fieldset disabled={busy}>
    <legend>Como delimitar a área de entrega?</legend>
    <div className="delivery-zone-mode">
     <label><input type="radio" name="delivery-zone-shape" checked={mode==='circle'}
       onChange={()=>{setMode('circle');setNotice('')}}/> Círculo por km em linha reta</label>
     <label><input type="radio" name="delivery-zone-shape" checked={mode==='polygon'}
       onChange={()=>{setMode('polygon');setNotice('')}}/> Polígono desenhado no mapa</label>
    </div>
    {mode==='circle'&&<label className="delivery-zone-range">
      <span>Raio de atendimento: <strong>{radius} km</strong> em linha reta</span>
      <input type="range" min="1" max="10" step="1" value={radius}
       onChange={e=>setRadius(Number(e.target.value))}/>
    </label>}
    {mode==='polygon'&&<div className="delivery-zone-polygon-actions">
      <p>Toque no mapa para ligar os pontos. Arraste um ponto para corrigir a divisa. Com três ou mais pontos, a região ficará preenchida.</p>
      <div><button type="button" className="secondary" disabled={!polygon.length}
       onClick={undoVertex}>Desfazer último ponto</button>
       <button type="button" className="secondary" disabled={!polygon.length}
       onClick={clearVertices}>Limpar desenho</button>
       <span>{polygon.length} de 30 pontos</span></div>
    </div>}
   </fieldset>
   <div ref={container} className="storefront-map delivery-zone-map"
    aria-label="Mapa visual para delimitar onde a loja faz entregas"/>
   <small>Geocodificação quando habilitada: Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a>.</small>
   <fieldset disabled={busy||!origin}>
    <legend>Quanto cobrar de frete?</legend>
    {mode==='circle'?<>
     <p>Escolha o frete de cada faixa de distância em <strong>linha reta</strong> a partir do marcador da loja. Distâncias fora do círculo não serão atendidas.</p>
     <div className="delivery-zone-rates">
      {rates.slice(0,radius).map((fee,i)=><label key={i}>Até {i+1} km (R$)
       <input type="number" inputMode="decimal" required min="0" max="999.99"
        step="0.01" value={fee} onChange={e=>setFee(i,e.target.value)}/></label>)}
     </div>
    </>:<label>Taxa fixa para todo o polígono (R$)
      <input type="number" inputMode="decimal" required min="0" max="999.99"
       step="0.01" value={polygonFee} onChange={e=>setPolygonFee(e.target.value)}/>
      <small>Pedidos fora do polígono serão recusados. É necessário confirmar o ponto do cliente no mapa.</small>
     </label>}
   </fieldset>
   <p className="storefront-delivery-note">O mapa e o cálculo do frete usam o mesmo limite. Frete grátis pode ser configurado como R$ 0,00. Distância por ruas não é a mesma coisa que distância em linha reta.</p>
   {enabled&&<p role="status">Regras de entrega ativas para o cardápio. Se alterar os limites ou preços, salve novamente.</p>}
   {error&&<p role="alert">{error}</p>}
   {notice&&<p role="status">{notice}</p>}
   <button type="submit" disabled={busy||!origin||status!=='ready'}>
    {busy?'Salvando…':'Salvar e ativar área de entrega'}
   </button>
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
