import {polygonValid} from './deliveryCoverageGeometry.mjs';
import React, {useEffect,useRef,useState} from 'react';
import {invoke} from './printBridge.mjs';
import {mountDeliveryCoverageMap} from './deliveryMap.mjs';
import {shopPoint,locateStoreByAddress} from './mapOrigin.mjs';
import {storefrontLink} from './storefrontLink.mjs';
import DeliveryCodeSettings from './DeliveryCodeSettings.jsx';
import {ModernModal,IntegrationRow,BrandTile} from './MerchantModern.jsx';
import PaymentHomologation from './PaymentHomologation.jsx';
import {ShoppingBag,Truck,Store,Wallet,CreditCard,ScanLine} from 'lucide-react';

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
 return <div className="modern-workspace modern-payments">
  <section className="panel" aria-label="Pagamentos do cardápio">
   <h3>Cardápio e formas de pagamento</h3>
   {error&&<p role="alert">{error} <button type="button" onClick={reload}>Tentar novamente</button></p>}
   {menu===undefined&&!error&&<p role="status">Carregando configurações…</p>}
   {menu===null&&<p role="status">O endereço da loja está sendo preparado.</p>}
   {draft&&<form onSubmit={save}>
    <fieldset disabled={busy}>
     <legend>Atendimento e publicação</legend>
     <label className="modern-switch-row"><ShoppingBag size={20}/><span>Publicar cardápio</span><input type="checkbox" checked={draft.enabled} onChange={e=>change('enabled',e.target.checked)}/></label>
     <label className="modern-switch-row"><Truck size={20}/><span>Aceitar entrega</span><input type="checkbox" checked={draft.delivery_enabled} onChange={e=>change('delivery_enabled',e.target.checked)}/></label>
     <label className="modern-switch-row"><Store size={20}/><span>Aceitar retirada</span><input type="checkbox" checked={draft.pickup_enabled} onChange={e=>change('pickup_enabled',e.target.checked)}/></label>
     <p className="storefront-delivery-note">Os valores de frete são definidos exclusivamente em <strong>Administrar Loja → Área de Entrega</strong>, não nas formas de pagamento.</p>
    </fieldset>
    <fieldset disabled={busy}>
     <legend>Formas aceitas no checkout</legend>
     {Object.entries(methods).map(([method,label])=><label key={method} className="modern-switch-row">{method==='dinheiro'?<Wallet size={20}/>:method==='cartao_entrega'?<CreditCard size={20}/>:<ScanLine size={20}/>}<span>{label}</span>
      <input type="checkbox" checked={draft.payment_methods.includes(method)} onChange={e=>change('payment_methods',
       e.target.checked?[...draft.payment_methods,method]:draft.payment_methods.filter(value=>value!==method))}/>
     </label>)}
     {draft.payment_methods.includes('pix_manual')&&<label>Instruções do Pix manual
      <textarea required minLength={3} maxLength={1000} value={draft.pix_instructions} onChange={e=>change('pix_instructions',e.target.value)}/>
     </label>}
    </fieldset>
    {failure&&<p role="alert">{failure}</p>}
    {notice&&<p role="status">{notice}</p>}
    <button className="modern-primary" disabled={busy||!draft.payment_methods.length||(!draft.delivery_enabled&&!draft.pickup_enabled)}>
     {busy?'Salvando…':'Salvar cardápio e pagamentos'}
    </button>
   </form>}
  </section>
  <PaymentProviders client={client} storeId={storeId}/>
  <DeliveryCodeSettings client={client} storeId={storeId}/>
 </div>;
}



const MAX_DELIVERY_POLYGONS=12;
const priorityDraft=v=>({enabled:v?.enabled===true,fee:v?.fee??'',min_minutes:v?.min_minutes??'',max_minutes:v?.max_minutes??''});
function PriorityFields({value,onChange}){const v=priorityDraft(value);return <fieldset className="delivery-region-editor"><legend>Entrega prioritária</legend><label><input type="checkbox" checked={v.enabled} onChange={e=>onChange({...v,enabled:e.target.checked})}/> Disponibilizar nesta área</label>{v.enabled&&<div className="delivery-zone-rates">{[['fee','Taxa prioritária (R$)'],['min_minutes','Prazo mínimo (min)'],['max_minutes','Prazo máximo (min)']].map(([k,label])=><label key={k}>{label}<input type="number" required min={k==='fee'?0:1} max={k==='fee'?999.99:720} step={k==='fee'?0.01:1} value={v[k]} onChange={e=>onChange({...v,[k]:e.target.value})}/></label>)}</div>}<small>A taxa substitui o frete padrão. O prazo deve ser menor.</small></fieldset>}
const deliveryRegionColors=['#ea580c','#2563eb','#059669','#9333ea','#d97706',
 '#db2777','#0e7490','#be123c','#64748b','#0d9488','#7c3aed','#ca8a04'];

export function StoreDeliveryArea({client,store}){
 const [automaticPoint,setAutomaticPoint]=useState(null);
 const [locationState,setLocationState]=useState('idle');
 const [locationRetry,setLocationRetry]=useState(0);
 const [locationMessage,setLocationMessage]=useState('');
 const locationAttempts=useRef(null);
 const savedPoint=shopPoint(store);
 // Unverified address-centre suggestions must never be used to charge freight.
 const origin=savedPoint||(automaticPoint?.storeId===store.id&&!automaticPoint.approximate?automaticPoint.point:null);
 const address=[store.address,store.address_number,store.neighborhood,
  store.city,store.state,store.postal_code].filter(Boolean).join(', ');
 const [mode,setMode]=useState('circle');
 const [radius,setRadius]=useState(5);
 const [rates,setRates]=useState(Array(10).fill(0));
 const [times,setTimes]=useState(Array.from({length:10},()=>({min_minutes:'',max_minutes:''})));
 const validTime=v=>v.min_minutes!==''&&v.max_minutes!==''&&Number.isInteger(Number(v.min_minutes))&&Number.isInteger(Number(v.max_minutes))&&Number(v.min_minutes)>=1&&Number(v.max_minutes)>=Number(v.min_minutes)&&Number(v.max_minutes)<=720;
 const numericTime=v=>({min_minutes:Number(v.min_minutes),max_minutes:Number(v.max_minutes),priority:v.priority?.enabled?{enabled:true,fee:Number(v.priority.fee),min_minutes:Number(v.priority.min_minutes),max_minutes:Number(v.priority.max_minutes)}:{enabled:false}});
 const [regions,setRegions]=useState([]);
 const [activeRegionId,setActiveRegionId]=useState(null);
 const [status,setStatus]=useState('loading');
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false);
 const [enabled,setEnabled]=useState(false);
 const [revision,setRevision]=useState(0);
 const [reloadAreas,setReloadAreas]=useState(0);
 const container=useRef(null),map=useRef(null);
 const activeRegion=regions.find(region=>region.id===activeRegionId)||null;
 const invalidRegions=regions.filter(r=>r.vertices.length>=3&&!polygonValid(r.vertices));
 const polygon=activeRegion?.vertices||[];
 const liveMapOptions=useRef({mode,radius,regions,activeRegionId});
 liveMapOptions.current={mode,radius,regions,activeRegionId};

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
  }).catch(failure=>{
   if(!alive)return;
   setLocationState('error');
   setLocationMessage('Não conseguimos localizar a loja automaticamente: '+(failure.message||String(failure))+
    '. O mapa continua disponível e você pode marcar a entrada em Dados e identidade.');
  });
  return()=>{alive=false;};
 },[client,store?.id,store?.address,store?.address_number,store?.neighborhood,
   store?.city,store?.state,store?.postal_code,savedPoint?.[0],savedPoint?.[1],locationRetry]);
 function retryLocation(){
  locationAttempts.current=null;setLocationState('idle');setAutomaticPoint(null);
  setLocationMessage('');setLocationRetry(n=>n+1);
 }

 useEffect(()=>{
  let live=true;
  setStatus('loading');setError('');
  (async()=>{
   try{
    const {data,error}=await client.from('pitacco_delivery_pricing')
     .select('coverage_type,max_radius_km,distance_fees,distance_times,polygon,polygon_fee,polygons,enabled')
     .eq('store_id',store.id).maybeSingle();
    if(error)throw error;
    if(!live)return;
    const isPolygon=data?.coverage_type==='polygon'||data?.coverage_type==='polygons';
    const stored=Array.isArray(data?.polygons)&&data.polygons.length
     ?data.polygons:Array.isArray(data?.polygon)&&data.polygon.length>=3
      ?[{id:'legacy-'+store.id,name:'Região 1',vertices:data.polygon,fee:Number(data.polygon_fee||0)}]:[];
    const normalized=stored.map((item,i)=>({
     id:String(item.id||'regiao-'+i),name:String(item.name||'Região '+(i+1)),
     vertices:Array.isArray(item.vertices)?item.vertices:[],
     fee:Number(item.fee||0),min_minutes:item.min_minutes??'',max_minutes:item.max_minutes??'',priority:priorityDraft(item.priority)
    }));
    setMode(isPolygon?'polygon':'circle');
    setRadius(data?.max_radius_km||5);
    setRates(Array.isArray(data?.distance_fees)&&data.distance_fees.length===10
     ?data.distance_fees.map(Number):Array(10).fill(0));
    setTimes(Array.from({length:10},(_,i)=>({min_minutes:data?.distance_times?.[i]?.min_minutes??'',max_minutes:data?.distance_times?.[i]?.max_minutes??'',priority:priorityDraft(data?.distance_times?.[i]?.priority)})));
    setRegions(normalized);
    setActiveRegionId(normalized[0]?.id||null);
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
   center:origin,mode,radiusKm:radius,regions,activeRegionId,
   onVerticesChange:(next,id)=>{if(alive){
    setRegions(previous=>previous.map(region=>
     region.id===id?{...region,vertices:next}:region));
    setNotice('');
   }},
   onSelectRegion:id=>{if(alive)setActiveRegionId(id)}
  }).then(instance=>{
   if(!alive){instance.remove();return;}
   map.current=instance;
   const latest=liveMapOptions.current;
   instance.setMode(latest.mode);
   instance.setRadius(latest.radius);
   instance.setRegions(latest.regions,latest.activeRegionId);
   instance.resize();
  }).catch(failure=>{if(alive)setError('Mapa indisponível: '+failure.message)});
  return()=>{alive=false;map.current?.remove();map.current=null};
 },[store.id,status,origin?.[0],origin?.[1],revision]);
 useEffect(()=>map.current?.setMode(mode),[mode]);
 useEffect(()=>map.current?.setRadius(radius),[radius]);
 useEffect(()=>map.current?.setRegions(regions,activeRegionId),[regions,activeRegionId]);

 function updateRegion(id,patch){
  setRegions(previous=>previous.map(region=>region.id===id?{...region,...patch}:region));
  setNotice('');
 }
 function addRegion(){
  if(regions.length>=MAX_DELIVERY_POLYGONS)return;
  const id=crypto.randomUUID();
  setRegions(previous=>[...previous,{
   id,name:'Região '+(previous.length+1),vertices:[],fee:0,min_minutes:'',max_minutes:''
  }]);
  setActiveRegionId(id);
  setNotice('');
 }
 function removeRegion(id){
  const remaining=regions.filter(region=>region.id!==id);
  setRegions(remaining);
  if(activeRegionId===id)setActiveRegionId(remaining[0]?.id||null);
  setNotice('');
 }
 function shiftRegion(id,direction){
  const index=regions.findIndex(region=>region.id===id),nextIndex=index+direction;
  if(index<0||nextIndex<0||nextIndex>=regions.length)return;
  const reordered=[...regions];
  [reordered[index],reordered[nextIndex]]=[reordered[nextIndex],reordered[index]];
  setRegions(reordered);
  setNotice('');
 }
 function undoVertex(){
  if(!activeRegion?.vertices.length)return;
  updateRegion(activeRegion.id,{vertices:activeRegion.vertices.slice(0,-1)});
 }
 function clearVertices(){
  if(activeRegion)updateRegion(activeRegion.id,{vertices:[]});
 }
 function setFee(index,value){
  setRates(previous=>previous.map((v,i)=>i===index?value:v));
 }
 async function save(event){
  event.preventDefault();setBusy(true);setError('');setNotice('');
  try{
   if(!origin)throw Error('Marque primeiro a entrada da loja em Dados e identidade.');
   if(!address)throw Error('Cadastre o endereço completo da loja.');
   let result;
   if(mode==='polygon'){
    if(!regions.length||regions.length>MAX_DELIVERY_POLYGONS)
     throw Error('Cadastre de 1 a 12 regiões poligonais.');
    for(const region of regions){
     if(!region.name?.trim()||region.name.trim().length>60)
      throw Error('Informe um nome de até 60 caracteres para cada região.');
     if(!Array.isArray(region.vertices)||region.vertices.length<3||region.vertices.length>30)
      throw Error('A região "'+region.name+'" precisa ter de 3 a 30 pontos no mapa.');
     if(!polygonValid(region.vertices))throw Error('A região "'+region.name+'" tem linhas cruzadas ou pontos inválidos. Redesenhe o contorno sem cruzar as linhas.');
     if(!Number.isFinite(Number(region.fee))||Number(region.fee)<0||Number(region.fee)>999.99)
      throw Error('Confira o valor do frete da região "'+region.name+'".');
    }
    if(regions.some(v=>v.priority?.enabled&&(!validTime(v.priority)||v.priority.fee===''||Number(v.priority.fee)<=Number(v.fee)||Number(v.priority.min_minutes)>=Number(v.min_minutes)||Number(v.priority.max_minutes)>=Number(v.max_minutes))))throw Error('A entrega prioritária precisa ter taxa maior e prazos menores.');
    if(regions.some(v=>!validTime(v)))throw Error('Informe os prazos mínimo e máximo de cada região.');
    result=await client.rpc('pitacco_save_delivery_polygons_times',{
     p_store:store.id,p_polygons:regions.map(region=>({
      id:region.id,name:region.name.trim(),
      vertices:region.vertices,fee:Number(region.fee),...numericTime(region)
     }))
    });
   }else{
    // Circle pricing stays unchanged, including individual per-km fees.
    const fees=rates.map(Number);
    if(fees.some(value=>!Number.isFinite(value)||value<0||value>999.99))
     throw Error('Confira os valores de entrega por quilômetro.');
    if(times.slice(0,radius).some((v,i)=>v.priority?.enabled&&(!validTime(v.priority)||v.priority.fee===''||Number(v.priority.fee)<=Number(fees[i])||Number(v.priority.min_minutes)>=Number(v.min_minutes)||Number(v.priority.max_minutes)>=Number(v.max_minutes))))throw Error('A entrega prioritária precisa ter taxa maior e prazos menores.');
    if(times.slice(0,radius).some(v=>!validTime(v)))throw Error('Informe os prazos mínimo e máximo de cada faixa ativa.');
    result=await client.rpc('pitacco_save_delivery_zone_times',{
     p_store:store.id,p_radius:radius,p_distance:fees,p_times:times.map(v=>validTime(v)?numericTime(v):null)
    });
   }
   if(result.error)throw result.error;
   if(!result.data?.saved||!result.data?.enabled)
    throw Error('A configuração não foi confirmada.');
   if(mode==='polygon'&&Array.isArray(result.data.polygons)){
    setRegions(result.data.polygons);
   }
   setEnabled(true);
   setNotice(mode==='polygon'
    ?'Regiões poligonais salvas. O cardápio aplicará a taxa da primeira região que contiver o cliente.'
    :'Taxas do círculo por quilômetro salvas para o cardápio digital.');
  }catch(failure){setError(failure.message||'Não foi possível salvar a área de entrega.');}
  finally{setBusy(false)}
 }
 return <section className="panel delivery-area-panel" aria-label="Área de entrega">
  <h3>Administrar Loja · Área de Entrega</h3>
  {mode==='polygon'&&invalidRegions.length>0&&<p role="alert" style={{color:'#b42333'}}>Revise {invalidRegions.map(r=>r.name).join(', ')}: o contorno tem linhas cruzadas ou pontos inválidos. Selecione a região, limpe os pontos e desenhe o contorno em ordem, sem cruzar linhas. O frete depende dessa correção; os valores cadastrados foram preservados.</p>}
  <p>Configure o círculo com taxas por km ou várias regiões poligonais com um preço por região. O cardápio utiliza somente o modo que você salvar.</p>
  <p><strong>Loja:</strong> {address||'Cadastre o endereço em Dados e identidade.'}</p>
  {!origin&&<p role="status">Aguardando a posição confirmada da loja. Você pode desenhar as regiões, mas só poderá ativar o frete quando confirmar o ponto de partida.</p>}
  {locationMessage&&<p role="status" className="storefront-delivery-note">{locationMessage}</p>}
  {locationState==='error'&&<button type="button" className="secondary" onClick={retryLocation}>Tentar localizar novamente</button>}
  {status==='loading'&&<p role="status">Carregando áreas de entrega…</p>}
  {status==='error'&&<button type="button" onClick={()=>setReloadAreas(n=>n+1)}>Tentar novamente</button>}
  {status==='ready'&&<form onSubmit={save} className="delivery-zone-config">
   <fieldset disabled={busy}>
    <legend>Como delimitar a área de entrega?</legend>
    <div className="delivery-zone-mode">
     <label><input type="radio" name="delivery-zone-shape" checked={mode==='circle'}
      onChange={()=>{setMode('circle');setNotice('')}}/> Círculo por km em linha reta</label>
     <label><input type="radio" name="delivery-zone-shape" checked={mode==='polygon'}
      onChange={()=>{setMode('polygon');setNotice('')}}/> Polígonos por região</label>
    </div>
    {mode==='circle'?<label className="delivery-zone-range">
     <span>Raio de atendimento: <strong>{radius} km</strong> em linha reta</span>
     <input type="range" min="1" max="10" step="1" value={radius}
      onChange={e=>setRadius(Number(e.target.value))}/>
    </label>:<>
     <div className="delivery-region-heading">
      <strong>Regiões de entrega ({regions.length} de {MAX_DELIVERY_POLYGONS})</strong>
      <button type="button" className="secondary"
       disabled={regions.length>=MAX_DELIVERY_POLYGONS||busy} onClick={addRegion}>+ Adicionar região</button>
     </div>
     <p>Selecione uma região para desenhar no mapa. Você pode criar até {MAX_DELIVERY_POLYGONS} polígonos, renomear, ajustar e definir um frete diferente para cada um.</p>
     <div className="delivery-region-list" role="list" aria-label="Regiões poligonais e suas prioridades">
      {regions.map((region,index)=><div role="listitem" key={region.id}
       className={'delivery-region-item'+(region.id===activeRegionId?' is-selected':'')}>
       <button type="button" className="delivery-region-select"
        onClick={()=>{setActiveRegionId(region.id);map.current?.focusRegion(region.id)}}>
        <span className="delivery-region-dot" style={{backgroundColor:deliveryRegionColors[index%deliveryRegionColors.length]}}/>
        <span><strong>{index+1}. {region.name||'Região sem nome'}</strong>
         <small>{region.vertices.length>=3&&!polygonValid(region.vertices)?'⚠ Contorno inválido · ':''}{region.vertices.length} pontos · R$ {Number(region.fee||0).toFixed(2).replace('.',',')}</small>
        </span>
       </button>
       <div className="delivery-region-item-actions">
        <button type="button" title="Subir prioridade" aria-label={'Subir '+region.name}
         disabled={index===0} onClick={()=>shiftRegion(region.id,-1)}>↑</button>
        <button type="button" title="Descer prioridade" aria-label={'Descer '+region.name}
         disabled={index===regions.length-1} onClick={()=>shiftRegion(region.id,1)}>↓</button>
        <button type="button" title="Excluir região" aria-label={'Excluir '+region.name}
         onClick={()=>removeRegion(region.id)}>×</button>
       </div>
      </div>)}
     </div>
     {activeRegion?<div className="delivery-region-editor">
      <strong>Editar região selecionada</strong>
      <div className="delivery-zone-rates">
       <label>Nome da região
        <input type="text" maxLength="60" required value={activeRegion.name}
         onChange={e=>updateRegion(activeRegion.id,{name:e.target.value})}/></label>
       <label>Valor do frete (R$)
        <input type="number" inputMode="decimal" required min="0" max="999.99"
         step="0.01" value={activeRegion.fee}
         onChange={e=>updateRegion(activeRegion.id,{fee:e.target.value})}/></label>
       {['min_minutes','max_minutes'].map(key=><label key={key}>{key==='min_minutes'?'Prazo mínimo (min)':'Prazo máximo (min)'}<input required type="number" min="1" max="720" step="1" value={activeRegion[key]??''} onChange={e=>updateRegion(activeRegion.id,{[key]:e.target.value})}/></label>)}
      </div>
      <PriorityFields value={activeRegion.priority} onChange={priority=>updateRegion(activeRegion.id,{priority})}/>
      <p>Toque no mapa para ligar os pontos desta região. Arraste os marcadores numerados para corrigir a divisa. As demais regiões continuam visíveis.</p>
      <div className="delivery-zone-polygon-actions">
       <div><button type="button" className="secondary" disabled={!polygon.length}
         onClick={undoVertex}>Desfazer último ponto</button>
        <button type="button" className="secondary" disabled={!polygon.length}
         onClick={clearVertices}>Limpar desenho</button>
        <span>{polygon.length} de 30 pontos nesta região</span>
       </div>
      </div>
     </div>:<p>Adicione uma região para começar a desenhar.</p>}
     <p className="storefront-delivery-note">Se duas regiões se sobrepuserem, o sistema usa a <strong>primeira região da lista</strong>. Use as setas para mudar a prioridade. Um ponto fora de todas as regiões não recebe entrega.</p>
    </>}
   </fieldset>
   <div ref={container} className="storefront-map delivery-zone-map"
    aria-label="Mapa visual para delimitar onde a loja faz entregas"/>
   <small>Geocodificação quando habilitada: Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a>.</small>
   {mode==='circle'&&<fieldset disabled={busy||!origin}>
    <legend>Quanto cobrar de frete?</legend>
    <p>Escolha o frete de cada faixa em <strong>linha reta</strong> a partir da lojinha. Distâncias fora do círculo não serão atendidas.</p>
    <div className="delivery-zone-rates">
     {rates.slice(0,radius).map((fee,i)=><div className="delivery-region-editor" key={i}><strong>Até {i+1} km</strong><label>Frete (R$)<input type="number" inputMode="decimal" required min="0" max="999.99" step="0.01" value={fee} onChange={e=>setFee(i,e.target.value)}/></label>{['min_minutes','max_minutes'].map(key=><label key={key}>{key==='min_minutes'?'Prazo mínimo (min)':'Prazo máximo (min)'}<input type="number" required min="1" max="720" step="1" value={times[i][key]} onChange={e=>setTimes(prev=>prev.map((v,j)=>i===j?{...v,[key]:e.target.value}:v))}/></label>)}<PriorityFields value={times[i].priority} onChange={priority=>setTimes(prev=>prev.map((v,j)=>i===j?{...v,priority}:v))}/></div>)}
    </div>
   </fieldset>}
   <p className="storefront-delivery-note">O mesmo limite desenhado no mapa define onde o cardápio permite entregas. Frete grátis pode ser configurado como R$ 0,00.</p>
   {enabled&&<p role="status">Regras de entrega ativas. Se alterar o modo, os limites ou os preços, salve novamente.</p>}
   {error&&<p role="alert">{error}</p>}
   {notice&&<p role="status">{notice}</p>}
   <button type="submit" disabled={busy||!origin||status!=='ready'}>
    {busy?'Salvando…':mode==='polygon'?'Salvar e ativar regiões poligonais':'Salvar e ativar círculo de entrega'}
   </button>
  </form>}
 </section>;
}

function PaymentProviders({client,storeId}){
 const [choices,setChoices]=useState(null),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0),[selected,setSelected]=useState(''),[failure,setFailure]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{let live=true;setChoices(null);client.from('pitacco_store_payment_providers').select('provider,requested_enabled').eq('store_id',storeId).then(({data,error})=>{if(!live)return;if(error)setFailure(error.message);else setChoices(Object.fromEntries((data||[]).map(row=>[row.provider,row.requested_enabled])))});return()=>{live=false}},[client,storeId,attempt]);
 async function save(e){e.preventDefault();setBusy(true);setFailure('');setNotice('');try{const rows=Object.keys(providers).map(provider=>({store_id:storeId,provider,requested_enabled:!!choices[provider]}));const {error}=await client.from('pitacco_store_payment_providers').upsert(rows,{onConflict:'store_id,provider'});if(error)throw error;setNotice('Preferências de integração salvas. A ativação depende da homologação.')}catch(e){setFailure(e.message||'Não foi possível salvar.')}finally{setBusy(false)}}
 return <section className="modern-workspace" aria-label="Integrações de pagamento"><div className="modern-section-title"><h3>Provedores online</h3></div><p className="modern-hint">Configure os provedores para recebimento online. A disponibilidade depende da homologação.</p>{failure&&<p role="alert">{failure}</p>}{choices===null&&(failure?<button onClick={()=>setAttempt(x=>x+1)}>Tentar novamente</button>:<p>Carregando provedores…</p>)}{choices&&<div className="modern-stack">{Object.entries(providers).sort(([a],[b])=>a==='pagbank'?-1:b==='pagbank'?1:0).map(([id,label])=><IntegrationRow key={id} id={id} label={label} status={choices[id]?'Solicitado':'Não conectado'} pending={!!choices[id]} onClick={()=>{setSelected(id);setNotice('')}}/>)}<IntegrationRow id="asaas" label="Asaas" status="Pendente" pending onClick={()=>setSelected('asaas')}/></div>}
 {selected&&<ModernModal title={providers[selected]||'Asaas'} subtitle="Configuração do provedor" icon={<BrandTile id={selected}/>} onClose={()=>setSelected('')}>{selected==='asaas'?<p>O Asaas ainda não está homologado como provedor de checkout desta loja.</p>:<><form onSubmit={save}><label className="modern-switch-row"><span>Solicitar recebimento online</span><input type="checkbox" checked={!!choices[selected]} onChange={e=>setChoices(x=>({...x,[selected]:e.target.checked}))}/></label><p className="modern-hint">Preferência não ativa pagamentos. Credenciais de produção não são solicitadas antes de existir conexão homologada.</p><button type="submit" className="modern-primary" disabled={busy}>Salvar preferências de integração</button>{notice&&<p role="status">{notice}</p>}</form><PaymentHomologation client={client} store={storeId} provider={selected} merchant/></>}</ModernModal>}</section>
}
