import {polygonValid} from './deliveryCoverageGeometry.mjs';
import React, {useEffect,useRef,useState} from 'react';
import {invoke} from './printBridge.mjs';
import {mountDeliveryCoverageMap} from './deliveryMap.mjs';
import {shopPoint,locateStoreByAddress} from './mapOrigin.mjs';
import {storefrontLink} from './storefrontLink.mjs';
import DeliveryCodeSettings from './DeliveryCodeSettings.jsx';
import {ModernModal,IntegrationRow,BrandTile} from './MerchantModern.jsx';
import PaymentHomologation from './PaymentHomologation.jsx';
import {ShoppingBag,Truck,Store,Wallet,CreditCard,ScanLine,Banknote,Smartphone,Utensils,KeyRound,Link2,Monitor,Percent,PlusCircle,MinusCircle,CheckCircle2,Calculator,Info,ChevronDown,ChevronUp,Save,Equal,Clock} from 'lucide-react';

const origin=import.meta.env.VITE_PITACCO_HOMOLOGACAO==='1'
 ? import.meta.env.VITE_PITACCO_HOMOLOG_SITE_ORIGIN || window.location.origin
 : 'https://pitacco.com.br';
const methods={dinheiro:'Dinheiro',cartao_credito:'Cartão de crédito',cartao_debito:'Cartão de débito',pix_maquininha:'Pix na maquininha',pix_manual:'Pix manual',voucher_alelo:'Alelo',voucher_pluxee:'Pluxee (Sodexo)',voucher_vr:'VR Benefícios',voucher_ticket:'Ticket'};
const expandPaymentMethods=values=>[...new Set((values||[]).flatMap(v=>v==='cartao_entrega'?['cartao_credito','cartao_debito']:[v]))];
const providers={mercado_pago:'Mercado Pago',pagbank:'PagBank (PagSeguro)',infinitepay:'InfinitePay'};
const menuFields='slug,enabled,delivery_enabled,pickup_enabled,payment_methods,pdv_payment_methods,pix_instructions';

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

// Draft editor: it deliberately cannot activate a price rule until the checkout
// accepts a server-calculated quote with explicit customer confirmation.
function PaymentPricingDrafts({client,storeId,menu}){
 const [open,setOpen]=useState(false),[channel,setChannel]=useState('cardapio'),[rows,setRows]=useState(null),[method,setMethod]=useState('dinheiro'),[mode,setMode]=useState('none'),[percent,setPercent]=useState('0'),[saving,setSaving]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [refresh,setRefresh]=useState(0),[releaseOpen,setReleaseOpen]=useState(false);
 const applicable=expandPaymentMethods(channel==='balcao'?(menu.pdv_payment_methods??menu.payment_methods):menu.payment_methods).filter(m=>!m.startsWith('voucher_')&&m!=='fiado'&&Object.hasOwn(methods,m));
 const selected=applicable.includes(method)?method:applicable[0]||'';
 const current=rows?.find(r=>r.channel===channel&&r.method===selected);
 const adjustment=Number(current?.adjustment_bps||0),activeAdjustment=Number(current?.active_adjustment_bps||0);
 useEffect(()=>{setOpen(false);setRows(null);setChannel('cardapio');setMethod('dinheiro');setError('');setMessage('')},[storeId]);
 useEffect(()=>{if(!open)return;let active=true;setRows(null);setError('');client.rpc('pitacco_payment_pricing_drafts',{p_store:storeId}).then(({data,error})=>{if(!active)return;if(error){setError('A configuração de preços ainda não está disponível. Nenhum preço foi alterado.');return}setRows(Array.isArray(data)?data:[])}).catch(()=>{if(active)setError('Não foi possível carregar as regras. Tente novamente.')});return()=>{active=false}},[open,client,storeId,refresh]);
 useEffect(()=>{setReleaseOpen(false);if(!open)return;let live=true;client.rpc('pitacco_payment_pricing_release_status',{p_store:storeId}).then(r=>{if(live&&!r.error)setReleaseOpen(r.data===true)}).catch(()=>{});return()=>{live=false}},[open,client,storeId,refresh]);
 useEffect(()=>{setMode(adjustment<0?'discount':adjustment>0?'increase':'none');setPercent(String(Math.abs(adjustment)/100))},[channel,selected,adjustment,current?.revision]);
 const bp=mode==='none'?0:Math.round(Number(percent)*100)*(mode==='discount'?-1:1);
 const valid=mode==='none'||(percent.trim()!==''&&Number.isFinite(bp)&&bp>=-9999&&bp<=10000&&Number(percent)>=0&&Math.abs(Number(percent)*100-Math.round(Number(percent)*100))<0.00001);
 const preview=valid?100+Math.round(bp)/100:100;
 async function save(e){e.preventDefault();if(!rows||!selected||!valid||saving)return;setSaving(true);setError('');setMessage('');
 try{const {data,error}=await client.rpc('pitacco_save_payment_pricing_draft',{p_store:storeId,p_channel:channel,p_method:selected,p_adjustment_bps:bp,p_processing_cost_bps:current?.processing_cost_bps||0,p_expected_revision:current?.revision||0});if(error)throw error;
 setRows(old=>[...old.filter(r=>r.channel!==channel||r.method!==selected),data]);setMessage('Rascunho salvo. Os valores cobrados ainda não foram alterados.');
 }catch(e){setError(e.message||'Não foi possível salvar o rascunho.')}finally{setSaving(false)}}
 const canPublish=Boolean(current&&valid&&bp===adjustment&&current.active_revision!==current.revision&&(releaseOpen||adjustment===0&&activeAdjustment!==0));
 async function publish(){if(!canPublish||saving)return;
 if(!window.confirm('Publicar '+methods[selected]+' — '+(channel==='balcao'?'Balcão e PDV':'Cardápio digital')+'? O novo percentual será aplicado aos próximos pedidos.'))return;
 setSaving(true);setMessage('');setError('');
 try{const {data,error}=await client.rpc('pitacco_publish_payment_price',{p_store:storeId,p_channel:channel,p_method:selected,p_expected_revision:current.revision});if(error)throw error;
 setRows(old=>[...old.filter(r=>r.channel!==channel||r.method!==selected),data]);setMessage('Regra publicada para os próximos pedidos.');
 }catch(e){setError(e.message||'Não foi possível publicar.')}finally{setSaving(false)}}
 const signedPercent=value=>(value>0?'+':'')+(value/100).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
 const currency=value=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 return <section className="panel ps-panel ps-pricing" aria-label="Preços por forma de pagamento">
 <PaymentSectionTitle icon={Percent} description="Configure acréscimos e descontos por canal de venda.">Preços por forma de pagamento</PaymentSectionTitle>
 {!open?<button type="button" className="secondary ps-price-expand" aria-expanded={false} onClick={()=>setOpen(true)}>Preparar regras de preço <ChevronDown size={17}/></button>:<>
 <div className="ps-price-notice" role="note"><Clock size={19}/><div><strong>{releaseOpen?'Configuração disponível':'Em preparação'}</strong><span>{releaseOpen?'Salve o rascunho e publique após conferir o valor.':'Novas publicações ainda não liberadas.'}</span></div></div>
 {error&&<div className="ps-price-error" role="alert">{error} <button type="button" className="secondary" disabled={saving} onClick={()=>setRefresh(v=>v+1)}>Recarregar regras</button></div>}
 {rows===null&&!error&&<p role="status">Carregando regras…</p>}
 {rows&&<form className="ps-price-form" onSubmit={save}><fieldset className="ps-price-fields" disabled={saving}>
 <div className="ps-price-block">
 <h4>Canal de venda</h4>
 <div className="ps-price-channels" role="group" aria-label="Canal de venda">
 {[[Store,'cardapio','Cardápio digital','Pedidos pelo link da loja'],[Monitor,'balcao','Balcão e PDV','Pedidos feitos no painel da loja']].map(([Icon,value,label,description])=><button type="button" key={value} className="ps-price-choice ps-price-channel" aria-pressed={channel===value} onClick={()=>{setChannel(value);setMessage('');setError('')}}><span className="ps-price-icon"><Icon size={22}/></span><span className="ps-price-choice-copy"><strong>{label}</strong><small>{description}</small></span><span className="ps-price-radio" aria-hidden="true">{channel===value&&<CheckCircle2 size={20}/>}</span></button>)}
 </div></div>
 <div className="ps-price-block">
 <h4>Forma de pagamento</h4>
 {applicable.length?<div className="ps-price-methods" role="group" aria-label="Forma de pagamento para ajuste">
 {applicable.map(m=>{const Icon=paymentIcons[m]||CreditCard;const rule=rows.find(r=>r.channel===channel&&r.method===m);const active=Number(rule?.active_adjustment_bps||0);return <button type="button" key={m} data-method={m} className="ps-price-choice ps-price-method" aria-pressed={selected===m} aria-label={methods[m]} onClick={()=>{setMethod(m);setMessage('');setError('')}}><Icon size={22}/><span className="ps-price-choice-copy"><strong>{methods[m]}</strong><small>Em vigor: {signedPercent(active)}</small></span><span className="ps-price-radio" aria-hidden="true">{selected===m&&<CheckCircle2 size={18}/>}</span></button>})}
 </div>:<p className="modern-empty">Habilite uma forma elegível nas configurações de pagamento.</p>}
 </div>
 {selected&&<>
 <div className="ps-price-editor">
 <div className="ps-price-block ps-price-adjustment"><h4>Qual ajuste deseja aplicar?</h4><p className="ps-price-context">{methods[selected]} · {channel==='balcao'?'Balcão e PDV':'Cardápio digital'}</p>
 <div className="ps-price-types" role="group" aria-label="Tipo de ajuste">
 {[[Equal,'none','Sem ajuste'],[PlusCircle,'increase','Acréscimo'],[MinusCircle,'discount','Desconto']].map(([Icon,value,label])=><button type="button" key={value} className={'ps-price-choice ps-price-type '+value} aria-pressed={mode===value} onClick={()=>{setMode(value);setMessage('');setError('')}}><Icon size={19}/><span>{label}</span></button>)}
 </div>
 {mode!=='none'&&<label className="ps-price-percent">Percentual (%)<span className="ps-price-input"><input required type="number" min="0" max={mode==='discount'?99.99:100} step="0.01" inputMode="decimal" value={percent} onChange={e=>{setPercent(e.target.value);setMessage('')}}/><span aria-hidden="true">%</span></span></label>}
 </div>
 <div className="ps-price-block ps-price-simulation"><h4><Calculator size={19}/> Simulação</h4><small>Em R$ 100,00 de produtos</small><strong>{valid?currency(preview):'—'}</strong><span>{!valid?'Informe um percentual válido.':bp>0?currency(bp/100)+' de acréscimo':bp<0?currency(Math.abs(bp)/100)+' de desconto':'Sem alteração no preço'}</span></div>
 </div>
 <div className="ps-price-summary">
 <div><small>Percentual em vigor</small><strong>{signedPercent(activeAdjustment)}</strong></div>
 <div><small>Rascunho salvo</small><strong>{signedPercent(adjustment)}</strong></div>
 {valid&&bp!==adjustment&&<div className="ps-price-unsaved"><small>Novo ajuste</small><strong>{signedPercent(bp)}</strong></div>}
 </div>
 <div className="ps-price-footnote"><Info size={17}/><span>Vouchers e Fiado não recebem ajuste. O ajuste incide apenas sobre os produtos após descontos, sem incluir a entrega.</span></div>
 <div className="ps-price-actions"><button type="button" className="secondary ps-price-collapse" aria-expanded={true} onClick={()=>setOpen(false)}><ChevronUp size={17}/> Ocultar regras de preço</button><button type="submit" className="ps-save" disabled={!valid||saving}><Save size={18}/> {saving?'Salvando…':'Salvar rascunho de preço'}</button>
 {canPublish&&<button type="button" className="modern-primary ps-price-publish" disabled={saving} onClick={publish}><CheckCircle2 size={18}/> {adjustment===0?'Publicar preço normal':'Publicar regra de preço'}</button>}</div>
 </>}
 {!selected&&<button type="button" className="secondary ps-price-collapse" aria-expanded={true} onClick={()=>setOpen(false)}><ChevronUp size={17}/> Ocultar regras de preço</button>}
 </fieldset></form>}
 {rows===null&&<button type="button" className="secondary ps-price-collapse" aria-expanded={true} onClick={()=>setOpen(false)}>Ocultar regras de preço</button>}
 {message&&<p className="ps-price-success" role="status">{message}</p>}
 </>}
 </section>;
}

const paymentDescriptions={dinheiro:'Pagamento em espécie.',cartao_credito:'Pagamento com cartão de crédito na maquininha.',cartao_debito:'Pagamento com cartão de débito na maquininha.',pix_maquininha:'Pagamento via Pix na maquininha.',pix_manual:'Transferência Pix com a chave da loja.'};
const paymentIcons={dinheiro:Banknote,cartao_credito:CreditCard,cartao_debito:CreditCard,pix_maquininha:ScanLine,pix_manual:ScanLine};
const voucherShort={voucher_alelo:'Alelo',voucher_pluxee:'Pluxee',voucher_vr:'VR',voucher_ticket:'Ticket'};
function PaymentSectionTitle({icon:Icon,children,description}){return <div className="ps-heading"><span className="ps-heading-icon"><Icon size={23}/></span><div><h3>{children}</h3>{description&&<p>{description}</p>}</div></div>}
function PaymentSwitch({icon:Icon,label,description,checked,onChange,accessibleLabel}){
 return <label className="ps-switch-row">{Icon&&<Icon className="ps-method-icon" size={22}/>}<span className="ps-switch-copy"><strong>{label}</strong>{description&&<small>{description}</small>}</span><span aria-hidden="true" className={'ps-status '+(checked?'on':'off')}>{checked?'Ativado':'Desativado'}</span><span className="ps-toggle"><input type="checkbox" aria-label={accessibleLabel||label} checked={Boolean(checked)} onChange={e=>onChange(e.target.checked)}/><span aria-hidden="true" className="ps-track"/></span></label>;
}
export function StorefrontPayments({client,storeId,resource}){
 const {menu,error,reload,update}=resource;
 const [publication,setPublication]=useState(null),[payment,setPayment]=useState(null),[busy,setBusy]=useState(''),[feedback,setFeedback]=useState({});
 const publicationKey=JSON.stringify(menu?[menu.enabled,menu.delivery_enabled,menu.pickup_enabled]:null);
 const paymentKey=JSON.stringify(menu?[menu.payment_methods,menu.pdv_payment_methods,menu.pix_instructions]:null);
 useEffect(()=>{setPublication(menu?{enabled:menu.enabled,delivery_enabled:menu.delivery_enabled,pickup_enabled:menu.pickup_enabled}:null)},[storeId,publicationKey]);
 useEffect(()=>{setPayment(menu?{payment_methods:expandPaymentMethods(menu.payment_methods),pdv_payment_methods:expandPaymentMethods(menu.pdv_payment_methods??menu.payment_methods),pix_instructions:menu.pix_instructions||''}:null)},[storeId,paymentKey]);
 useEffect(()=>setFeedback({}),[storeId]);
 function changePublication(field,value){setPublication(old=>({...old,[field]:value}));setFeedback(old=>({...old,publication:null}))}
 function changePayment(field,method,checked){setPayment(old=>({...old,[field]:checked?[...new Set([...old[field],method])]:old[field].filter(v=>v!==method)}));setFeedback(old=>({...old,payment:null}))}
 async function save(event,kind){
  event.preventDefault();if(busy)return;setBusy(kind);setFeedback(old=>({...old,[kind]:null}));
  try{
   const args=kind==='publication'?{p_store:storeId,p_enabled:publication.enabled,p_delivery_enabled:publication.delivery_enabled,p_pickup_enabled:publication.pickup_enabled}:{p_store:storeId,p_public:payment.payment_methods,p_pdv:payment.pdv_payment_methods,p_pix_instructions:payment.pix_instructions};
   const {data,error}=await client.rpc(kind==='publication'?'pitacco_save_storefront_publication':'pitacco_save_payment_methods_only',args);
   if(error)throw error;if(!data||data.saved!==true)throw Error('A configuração não foi confirmada pelo servidor.');
   const {saved,...fields}=data;update({...menu,...fields});
   setFeedback(old=>({...old,[kind]:{message:kind==='publication'?'Publicação salva.':'Formas de pagamento salvas.'}}));
  }catch(e){setFeedback(old=>({...old,[kind]:{error:e.message||'Não foi possível salvar.'}}))}
  finally{setBusy('')}
 }
 function status(kind){return feedback[kind]?.error?<p role="alert">{feedback[kind].error}</p>:feedback[kind]?.message?<p role="status">{feedback[kind].message}</p>:null}
 const hasPix=payment&&(payment.payment_methods.includes('pix_manual')||payment.pdv_payment_methods.includes('pix_manual'));
 return <div className="modern-workspace modern-payments ps-workspace">
  <h2 className="ps-page-title">Cardápio e formas de pagamento</h2>
  {error&&<p role="alert">{error} <button type="button" onClick={reload}>Tentar novamente</button></p>}
  {menu===undefined&&!error&&<p role="status">Carregando configurações…</p>}
  {menu===null&&<p role="status">O endereço da loja está sendo preparado.</p>}
  {publication&&<section className="panel ps-panel" aria-label="Publicação e atendimento"><PaymentSectionTitle icon={Store}>Publicação e atendimento</PaymentSectionTitle>
   <form className="ps-form" onSubmit={e=>save(e,'publication')}><fieldset disabled={Boolean(busy)} className="ps-group ps-publication">
    {[[ShoppingBag,'enabled','Publicar cardápio','Controla se o cardápio está disponível ao cliente.'],[Truck,'delivery_enabled','Aceitar entrega','Permite pedidos com entrega.'],[Store,'pickup_enabled','Aceitar retirada','Permite pedidos para retirada no local.']].map(([Icon,field,label,description])=><PaymentSwitch key={field} icon={Icon} label={label} description={description} checked={publication[field]} onChange={v=>changePublication(field,v)}/>)}
   </fieldset>{status('publication')}<button type="submit" className="modern-primary ps-save" disabled={Boolean(busy)||(!publication.delivery_enabled&&!publication.pickup_enabled)}>{busy==='publication'?'Salvando…':'Salvar publicação'}</button></form>
  </section>}
  {payment&&<section className="panel ps-panel" aria-label="Formas de pagamento"><PaymentSectionTitle icon={CreditCard} description="Configure as formas aceitas em cada canal de venda.">Formas de pagamento</PaymentSectionTitle>
   <form className="ps-form" onSubmit={e=>save(e,'payment')}>
    {[[Smartphone,'payment_methods','Cardápio digital — pagamento presencial'],[Store,'pdv_payment_methods','Balcão e PDV']].map(([Icon,field,title])=><fieldset key={field} disabled={Boolean(busy)} className="ps-group"><legend className="ps-group-title"><Icon size={20}/>{title}</legend><div className="ps-group-body">
     {Object.entries(methods).filter(([method])=>!method.startsWith('voucher_')).map(([method,label])=><PaymentSwitch key={method} icon={paymentIcons[method]} label={method==='pix_manual'&&field==='payment_methods'?'Pix manual (transferência)':label} description={paymentDescriptions[method]} checked={payment[field].includes(method)} onChange={v=>changePayment(field,method,v)}/>)}
    </div></fieldset>)}
    <fieldset disabled={Boolean(busy)} className="ps-group"><legend className="ps-group-title"><Utensils size={20}/>Vale-refeição — somente na maquininha</legend><div className="ps-group-body"><p className="ps-voucher-note">Habilite apenas as bandeiras aceitas pela sua maquininha. O Pitacco não processa esses pagamentos.</p><div className="ps-voucher-grid">
     {Object.entries(methods).filter(([method])=>method.startsWith('voucher_')).map(([method,label])=><div key={method} className="ps-voucher-card"><div className="ps-voucher-title"><span className={'ps-voucher-brand '+method}>{voucherShort[method]}</span><strong>{label}</strong></div>{[['payment_methods','Cardápio digital'],['pdv_payment_methods','Balcão']].map(([field,channel])=><PaymentSwitch key={field} label={channel} accessibleLabel={label+' — '+channel} checked={payment[field].includes(method)} onChange={v=>changePayment(field,method,v)}/>)}</div>)}
    </div></div></fieldset>
    {hasPix&&<label className="ps-pix"><span><KeyRound size={20}/> Instruções do Pix manual</span><textarea required minLength={3} maxLength={1000} value={payment.pix_instructions} disabled={Boolean(busy)} onChange={e=>{setPayment(old=>({...old,pix_instructions:e.target.value}));setFeedback(old=>({...old,payment:null}))}}/></label>}
    {status('payment')}<button type="submit" className="modern-primary ps-save" disabled={Boolean(busy)||!payment.payment_methods.length||!payment.pdv_payment_methods.length}>{busy==='payment'?'Salvando…':'Salvar formas de pagamento'}</button>
   </form>
  </section>}
  <PaymentProviders client={client} storeId={storeId}/>
  {menu&&<PaymentPricingDrafts key={storeId} client={client} storeId={storeId} menu={menu}/>}
 </div>;
}

const MAX_DELIVERY_POLYGONS=12;
const priorityDraft=v=>({enabled:v?.enabled===true,fee:v?.fee??'',min_minutes:v?.min_minutes??'',max_minutes:v?.max_minutes??''});
function PriorityFields({value,onChange}){const v=priorityDraft(value);return <fieldset className="delivery-region-editor"><legend>Entrega prioritária</legend><label><input type="checkbox" checked={v.enabled} onChange={e=>onChange({...v,enabled:e.target.checked})}/> Disponibilizar nesta área</label>{v.enabled&&<div className="delivery-zone-rates">{[['fee','Taxa prioritária (R$)'],['min_minutes','Prazo mínimo (min)'],['max_minutes','Prazo máximo (min)']].map(([k,label])=><label key={k}>{label}<input type="number" required min={k==='fee'?0:1} max={k==='fee'?999.99:720} step={k==='fee'?0.01:1} value={v[k]} onChange={e=>onChange({...v,[k]:e.target.value})}/></label>)}</div>}<small>A taxa substitui o frete padrão. O prazo deve ser menor.</small></fieldset>}
const deliveryRegionColors=['#ea580c','#2563eb','#059669','#9333ea','#d97706',
 '#db2777','#0e7490','#be123c','#64748b','#0d9488','#7c3aed','#ca8a04'];

export function StoreDeliveryArea({client,store}){
 return <div className="modern-workspace" aria-label="Configurações de entrega">
  <DeliveryCodeSettings key={store.id} client={client} storeId={store.id}/>
  <DeliveryAreaPricing key={store.id} client={client} store={store}/>
 </div>;
}
function DeliveryAreaPricing({client,store}){
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
  <h3>Área de entrega</h3>
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
