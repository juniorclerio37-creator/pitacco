import React,{useEffect,useMemo,useRef,useState} from 'react';
import PizzaBuilder from './PizzaBuilder.jsx';
import {ShoppingCart,Store,Bike,ShoppingBag,CalendarDays,UserRound,UserRoundPlus,Search,LayoutGrid,Layers,Plus,Minus,Trash2,MessageSquare,CreditCard,Check,ChevronUp,Package,X} from 'lucide-react';
import {CategoryIcon,inferCategoryIcon} from './CategoryIcons.jsx';
import {quotePizzaSelection} from './pizzaPricing.mjs';
const money=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const methods={dinheiro:'Dinheiro',cartao_credito:'Cartão de crédito',cartao_debito:'Cartão de débito',pix_maquininha:'Pix na maquininha',pix_manual:'Pix manual',voucher_alelo:'Alelo',voucher_pluxee:'Pluxee (Sodexo)',voucher_vr:'VR Benefícios',voucher_ticket:'Ticket',pix:'Pix',cartao:'Cartão',cartao_entrega:'Cartão',cartao_na_entrega:'Cartão',credit_card:'Cartão de crédito',debit_card:'Cartão de débito'};
const expandPaymentMethods=values=>[...new Set((values||[]).flatMap(v=>v==='cartao_entrega'?['cartao_credito','cartao_debito']:[v]))];
const id=()=>crypto.randomUUID();
export default function MerchantNewOrder({client,storeId,onNavigate}){
 const [menu,setMenu]=useState(null),[loyalty,setLoyalty]=useState(false),[fiado,setFiado]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[result,setResult]=useState(null);
 const [name,setName]=useState(''),[phone,setPhone]=useState(''),[search,setSearch]=useState(''),[customers,setCustomers]=useState([]),[type,setType]=useState('balcao'),[payment,setPayment]=useState(''),[address,setAddress]=useState(''),[notes,setNotes]=useState(''),[change,setChange]=useState(''),[coupon,setCoupon]=useState(''),[credit,setCredit]=useState(''),[cart,setCart]=useState([]),[product,setProduct]=useState(null),[chosen,setChosen]=useState([]),[quantity,setQuantity]=useState(1),[quote,setQuote]=useState(null),[quoting,setQuoting]=useState(false);
 const [manualDiscount,setManualDiscount]=useState(''),[pdvMethods,setPdvMethods]=useState([]),[received,setReceived]=useState(false);
 const [pdvPriceRules,setPdvPriceRules]=useState({}),[pricePreview,setPricePreview]=useState(null),[previewError,setPreviewError]=useState('');
 const request=useRef(id()),lock=useRef(false);
 async function rpc(n,args){const r=await client.rpc(n,args);if(r.error)throw r.error;if(r.data?.error)throw Error(r.data.error);return r.data}
 useEffect(()=>{let live=true;(async()=>{try{
  const r=await client.from('public_menu_settings').select('slug,enabled,pdv_payment_methods').eq('store_id',storeId).maybeSingle();if(r.error)throw r.error;
  if(!r.data?.enabled)throw Error('O cardápio digital precisa estar publicado para este fluxo integrado.');
  const data=await rpc('get_public_menu',{p_slug:r.data.slug});
  const [program,creditData]=await Promise.all([client.rpc('pitacco_loyalty_program',{p_slug:r.data.slug}),client.rpc('pitacco_fiado_overview',{p_store:storeId})]);
  if(!live)return;if(program.error)throw program.error;
  if(data.store.payment_price_rules!==undefined){const rules=await rpc('pitacco_merchant_payment_price_rules',{p_store:storeId});if(!live)return;setPdvPriceRules(rules||{});}
  setMenu(data);setPdvMethods(expandPaymentMethods(r.data.pdv_payment_methods??data.store.payment_methods));setType(data.store.pickup_enabled?'balcao':'entrega');setLoyalty(!!program.data);setFiado((creditData.data?.customers||[]).filter(c=>c.enabled));setPayment(expandPaymentMethods(data.store.pickup_enabled?(r.data.pdv_payment_methods??data.store.payment_methods):data.store.payment_methods)[0]||'');
 }catch(e){if(live)setError(e.message||String(e))}finally{if(live)setLoading(false)}})();return()=>{live=false}},[client,storeId]);
 useEffect(()=>{let live=true;if(search.trim().length<2){setCustomers([]);return}const t=setTimeout(()=>{client.rpc('pitacco_merchant_customers',{p_store:storeId,p_query:search,p_offset:0}).then(r=>{if(live&&!r.error)setCustomers(r.data?.rows||[])})},300);return()=>{live=false;clearTimeout(t)}},[client,storeId,search]);
 const delivery=type==='entrega',isCredit=payment==='fiado';
 const availablePayments=delivery?expandPaymentMethods(menu?.store?.payment_methods):pdvMethods;
 const externalPayment=['dinheiro','cartao_credito','cartao_debito','pix_maquininha','pix_manual','voucher_alelo','voucher_pluxee','voucher_vr','voucher_ticket'].includes(payment);
 useEffect(()=>{setReceived(false)},[cart,payment,type,coupon,manualDiscount]);
 const [searchProduct,setSearchProduct]=useState(''),[category,setCategory]=useState(''),[customerOpen,setCustomerOpen]=useState(true),[cartOpen,setCartOpen]=useState(false);
 const summaryRef=useRef(null);
 const products=menu?.products||[],categories=[...new Set(products.map(p=>String(p.category||'Outros')))];
 const normalize=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const shown=products.filter(p=>(!category||String(p.category||'Outros')===category)&&normalize(p.name+' '+(p.category||'')).includes(normalize(searchProduct)));
 const itemCount=cart.reduce((n,l)=>n+l.quantity,0);
 function selectType(value){setType(value);setManualDiscount('');setReceived(false);const available=value==='entrega'?expandPaymentMethods(menu.store.payment_methods):pdvMethods;if(!available.includes(payment))setPayment(available[0]||'')}
 function changeLine(key,delta){setCart(previous=>previous.map(l=>l.key===key?{...l,quantity:Math.max(0,Math.min(20,l.quantity+delta))}:l).filter(l=>l.quantity>0))}
 function openSummary(){setCartOpen(true);requestAnimationFrame(()=>summaryRef.current?.scrollIntoView({behavior:'smooth',block:'start'}))}

 const subtotal=useMemo(()=>cart.reduce((sum,l)=>sum+l.quantity*l.unit,0),[cart]);
 const discount=isCredit&&type==='balcao'?Number(manualDiscount||0):0;
 const invalidDiscount=!Number.isFinite(discount)||discount<0||(discount>0&&discount>=subtotal);
 const rule=!isCredit&&!payment.startsWith('voucher_')?(delivery?menu?.store?.payment_price_rules:pdvPriceRules)?.[payment]:null;
 const activeRule=rule&&Number.isInteger(rule.adjustment_bps)&&rule.adjustment_bps!==0&&Number.isSafeInteger(rule.revision)&&rule.revision>0?rule:null;
 const previewKey=JSON.stringify([storeId,type,payment,phone,coupon,cart.map(({product_id,quantity,options})=>({product_id,quantity,options}))]);
 useEffect(()=>{
  setPricePreview(null);setPreviewError('');
  if(!activeRule||!coupon.trim()||!cart.length||!menu)return;
  let live=true;const timer=setTimeout(async()=>{try{
   const r=await client.rpc('pitacco_loyalty_preview',{p_slug:menu.store.slug,p_items:cart.map(({product_id,quantity,options})=>({product_id,quantity,options})),p_key:phone,p_coupon:coupon.trim().toUpperCase(),p_reward:''});
   if(r.error)throw r.error;
   if(live)setPricePreview({key:previewKey,discount:Number(r.data.discount_cents)/100,subtotal:Number(r.data.subtotal_cents)/100});
  }catch(e){if(live)setPreviewError(e.message||'Não foi possível validar o cupom.')}},350);
  return()=>{live=false;clearTimeout(timer)};
 },[client,menu,previewKey,activeRule?.revision]);
 const currentPreview=pricePreview?.key===previewKey?pricePreview:null;
 const waitingPrice=Boolean(activeRule&&coupon.trim()&&!currentPreview);
 const priceBase=activeRule&&currentPreview?currentPreview.subtotal:subtotal;
 const appliedDiscount=activeRule&&currentPreview?currentPreview.discount:invalidDiscount?0:discount;
 const baseCents=Math.max(0,Math.round(priceBase*100)-Math.round(appliedDiscount*100));
 const priceAdjustment=activeRule?Math.sign(activeRule.adjustment_bps)*Math.round(baseCents*Math.abs(activeRule.adjustment_bps)/10000)/100:0;
 const amount=Math.round((priceBase+(delivery?Number(quote?.fee||0):0)-appliedDiscount+priceAdjustment)*100)/100;
 useEffect(()=>setReceived(false),[amount,activeRule?.revision,waitingPrice]);
 const validProduct=product&&!product.pizza_config&&(product.option_groups||[]).every(g=>{const n=(g.options||[]).filter(o=>chosen.includes(o.id)).length;return n>=Number(g.min||0)&&n<=Number(g.max??100)});
 function add(){if(!validProduct)return;const options=[...chosen].sort(),key=product.id+':'+options.join(',');
 const unit=Number(product.price)+(product.option_groups||[]).flatMap(g=>g.options||[]).filter(o=>options.includes(o.id)).reduce((n,o)=>n+Number(o.price),0);
 const names=(product.option_groups||[]).flatMap(g=>g.options||[]).filter(o=>options.includes(o.id)).map(o=>o.name);
 insertLine(options,names,unit);}
 function addPizza(selection){try{if(!product?.pizza_config)return;const q=quotePizzaSelection(product.pizza_config,selection);insertLine(q.options,q.names,q.total/100);}catch(e){setError(e.message||'Montagem inválida');}}
 function insertLine(options,names,unit){const key=product.id+':'+options.join(',');const old=cart.find(l=>l.key===key);if(!Number.isInteger(quantity)||quantity<1||(old?.quantity||0)+quantity>20){setError('Máximo de 20 unidades por combinação.');return}if(!old&&cart.length>=30){setError('Máximo de 30 combinações por pedido.');return}
 setCart(previous=>old?previous.map(l=>l.key===key?{...l,quantity:l.quantity+quantity}:l):[...previous,{key,product_id:product.id,name:product.name,options,names,quantity,unit}]);setProduct(null);setChosen([]);setQuantity(1);setError('')}
 useEffect(()=>{setQuote(null);if(!delivery||!menu||address.trim().length<12)return;let live=true;const t=setTimeout(async()=>{setQuoting(true);try{
 const r=await client.functions.invoke('delivery-quote',{body:{slug:menu.store.slug,address:address.trim(),request_id:request.current}});if(r.error)throw r.error;if(r.data?.error||!r.data?.quote_id)throw Error(r.data?.error||'Frete indisponível');if(live){setQuote(r.data);setError('')}
 }catch(e){if(live)setError('Frete: '+(e.message||String(e)))}finally{if(live)setQuoting(false)}},600);return()=>{live=false;clearTimeout(t);setQuoting(false)}},[client,menu,delivery,address]);
 async function submit(e){e.preventDefault();if(lock.current||!cart.length||!payment||waitingPrice)return;
 if(delivery&&(!quote?.quote_id||new Date(quote.expires_at)<=new Date())){setError('É necessário recalcular o frete antes de confirmar.');return}
 if(isCredit&&(!credit||delivery)){setError('Selecione um cliente autorizado. Fiado neste fluxo está disponível para balcão e retirada.');return}
 if(!isCredit&&(name.trim().length<2||phone.replace(/\D/g,'').length<10)){setCustomerOpen(true);setError('Informe nome e telefone com DDD.');return}
 if(payment==='dinheiro'&&change&&(!Number.isFinite(Number(change))||Number(change)<amount)){setError('Informe um valor para troco igual ou maior que o total estimado.');return}
 if(invalidDiscount){setError('O desconto manual deve ser inferior ao subtotal.');return}
 lock.current=true;setBusy(true);setError('');
 try{
 const items=cart.map(({product_id,quantity,options})=>({product_id,quantity,options}));
 const note=notes.trim()+(payment==='dinheiro'&&change?' Troco para: R$ '+Number(change).toFixed(2):'');
 const data=isCredit&&type==='balcao'?await rpc('pitacco_fiado_balcao_discount',{p_store:storeId,p_customer:credit,p_request:request.current,p_items:items,p_note:notes.trim(),p_discount:discount}):await rpc(activeRule?'pitacco_confirm_priced_merchant_checkout':'pitacco_merchant_channel_checkout',{p_store:storeId,p_request:request.current,p_sale_mode:type,p_customer:isCredit?'':name.trim(),p_phone:isCredit?'':phone,p_address:delivery?address.trim():'',p_items:items,p_payment:payment,p_notes:isCredit?notes.trim():note,p_coupon:isCredit?'':coupon.trim(),p_quote:delivery?quote.quote_id:null,p_fiado_customer:isCredit?credit:null,p_received_amount:!delivery&&externalPayment&&received?Math.round(amount*100)/100:null,...(activeRule?{p_expected_cents:Math.round(amount*100),p_price_revision:activeRule.revision}:{})});
 if(!data?.order_id)throw Error('Pedido não confirmado pelo servidor. Verifique antes de repetir.');
 setResult(data);
 }catch(e){
 if(/Preço por pagamento atualizado/.test(e.message||'')){
  setReceived(false);
  try{
   const [publicRules,localRules]=await Promise.all([rpc('pitacco_public_payment_price_rules',{p_slug:menu.store.slug}),rpc('pitacco_merchant_payment_price_rules',{p_store:storeId})]);
   setMenu(old=>({...old,store:{...old.store,payment_price_rules:publicRules}}));
   setPdvPriceRules(localRules);
   setError('O percentual foi alterado. Confira o novo valor e confirme a venda novamente.');
  }catch{setError('Não foi possível atualizar o percentual. Reabra o Novo Pedido antes de confirmar.')}
 }else setError(e.message||String(e))
 }finally{lock.current=false;setBusy(false)}}
 if(loading)return <section className="panel">Carregando cardápio da loja…</section>;
 if(!menu)return <section className="panel"><h3>Novo Pedido</h3><p role="alert">{error}</p><button onClick={()=>onNavigate('Cozinha e expedição')}>Ir ao lançamento manual existente</button></section>;
 if(result)return <section className="panel" role="status"><h3>Pedido registrado</h3><p>#{result.order_id.slice(0,8)} · {money(result.total)}</p><p>Acompanhe o aceite, preparo e pagamento em Pedidos.</p><button onClick={()=>onNavigate('Pedidos')}>Abrir pedidos</button></section>;
 return <section className="mn-pos mn-pos-v2" aria-label="Novo pedido">
 <div className="mn-pos-hero"><div className="mn-pos-hero-icon"><ShoppingCart size={34}/><Plus size={16}/></div><div><h2>Novo Pedido</h2><p>Lance uma venda no sistema de forma rápida e completa.</p></div><div className="mn-pos-hero-art" aria-hidden="true"><ShoppingBag size={64}/></div></div>
 {error&&<p role="alert" className="notice error">{error}</p>}
 <form onSubmit={submit}><fieldset disabled={busy} className="mn-pos-fieldset">
 <section className="mn-pos-service" aria-label="Tipo de atendimento"><h3><Store size={19}/> Tipo de atendimento</h3><div className="mn-pos-modes">{[['balcao','Balcão',Store,menu.store.pickup_enabled],['entrega','Entrega',Bike,menu.store.delivery_enabled],['retirada','Retirada',ShoppingBag,menu.store.pickup_enabled]].map(([value,label,Icon,enabled])=><button key={value} type="button" className={'mn-pos-mode '+(type===value?'selected':'')} aria-pressed={type===value} disabled={!enabled} onClick={()=>selectType(value)}><Icon size={22}/>{label}</button>)}<button type="button" className="mn-pos-mode" disabled title="Agendamento de venda direta ainda indisponível"><CalendarDays size={22}/>Agendado <small>Indisponível</small></button></div></section>
 <div className="mn-pos-grid"><div className="mn-pos-main">
 <section className="mn-pos-card mn-pos-customer" aria-label="Cliente do pedido"><div className="mn-pos-customer-bar"><h3><UserRound size={22}/> Cliente</h3><div className="mn-pos-search"><Search size={18}/><input aria-label="Buscar cliente" placeholder="Buscar por nome ou telefone" value={search} onChange={e=>setSearch(e.target.value)}/></div><button type="button" className="secondary mn-pos-icon-button" aria-label="Cadastrar ou editar cliente" aria-expanded={customerOpen} onClick={()=>setCustomerOpen(v=>!v)}><UserRoundPlus size={20}/></button></div>
 {customers.filter(c=>c.phone).map(c=><button key={c.customer_key} type="button" className="secondary mn-pos-customer-result" onClick={()=>{setName(c.name);setPhone(c.phone);setSearch('');setCustomers([]);setCustomerOpen(false)}}>{c.name} · {c.phone}</button>)}
 {!isCredit&&(customerOpen?<div className="mn-pos-customer-fields"><label>Nome<input autoComplete="off" required value={name} onChange={e=>setName(e.target.value)}/></label><label>Telefone com DDD<input required type="tel" autoComplete="off" value={phone} onChange={e=>setPhone(e.target.value)}/></label></div>:<p className="mn-pos-client-caption">{name?name+' · '+phone:'Nenhum cliente selecionado'}</p>)}
 </section>
 <section className="mn-pos-card mn-pos-catalog" aria-label="Produtos do cardápio"><h3><Layers size={21}/> Produtos do cardápio</h3><div className="mn-pos-categories" aria-label="Categorias"><button type="button" className={!category?'selected':''} aria-pressed={!category} onClick={()=>setCategory('')}><LayoutGrid size={24}/>Todos</button>{categories.map(c=><button key={c} type="button" className={category===c?'selected':''} aria-pressed={category===c} onClick={()=>setCategory(c)}><CategoryIcon icon={inferCategoryIcon(c)} size={25}/>{c}</button>)}</div>
 <div className="mn-pos-search"><Search size={19}/><input aria-label="Buscar produto ou categoria" placeholder="Buscar produto ou categoria" value={searchProduct} onChange={e=>setSearchProduct(e.target.value)}/></div>
 <div className="mn-pos-products">{shown.map(p=><button key={p.id} type="button" className="mn-pos-product" aria-label={'Selecionar '+p.name} onClick={()=>{setProduct(p);setChosen([]);setQuantity(1)}}><div className="mn-pos-product-image">{p.image_url?<img src={p.image_url} alt="" loading="lazy" onError={e=>{e.currentTarget.hidden=true}}/>:<CategoryIcon icon={inferCategoryIcon(p.category||p.name)} size={42}/>}</div><div className="mn-pos-product-info"><span>{p.name}</span><div><strong>{p.pizza_config?'A partir de ':''}{money(p.price)}</strong><i aria-hidden="true"><Plus size={17}/></i></div></div></button>)}</div>{!shown.length&&<p className="mn-pos-client-caption">Nenhum produto encontrado.</p>}
 </section>
 </div><div className={'mn-pos-card mn-pos-summary '+(cartOpen?'expanded':'')} ref={summaryRef} aria-label="Resumo do pedido"><h3 className="mn-pos-summary-heading"><ShoppingBag size={22}/> Resumo do pedido</h3><div className="mn-pos-summary-content">
 {cart.length===0&&<p className="mn-pos-empty">Nenhum item adicionado.</p>}{cart.map(l=>{const item=products.find(p=>p.id===l.product_id);return <div className="mn-pos-cart-line" key={l.key}><div className="mn-pos-cart-image">{item?.image_url?<img src={item.image_url} alt="" loading="lazy"/>:<Package size={24}/>}</div><div className="mn-pos-cart-text"><b>{l.name}</b><small>{l.names.join(', ')}</small><small>{l.quantity} × {money(l.unit)}</small><div className="mn-pos-quantity"><button type="button" className="secondary" aria-label={'Diminuir quantidade de '+l.name} onClick={()=>changeLine(l.key,-1)}><Minus size={15}/></button><b>{l.quantity}</b><button type="button" className="secondary" disabled={l.quantity>=20} aria-label={'Aumentar quantidade de '+l.name} onClick={()=>changeLine(l.key,1)}><Plus size={15}/></button></div></div><div className="mn-pos-cart-end"><button type="button" className="mn-pos-remove" aria-label={'Remover '+l.name} onClick={()=>setCart(v=>v.filter(x=>x.key!==l.key))}><Trash2 size={17}/></button><strong>{money(l.unit*l.quantity)}</strong></div></div>})}
 <label className="mn-pos-notes"><span><MessageSquare size={18}/> Observação do pedido</span><textarea maxLength={900} placeholder="Ex.: sem granola, pouco doce..." value={notes} onChange={e=>setNotes(e.target.value)}/></label>
 <div className="mn-pos-totals"><div className="line"><span>Subtotal</span><strong>{money(subtotal)}</strong></div>{delivery&&<div className="line"><span>Entrega</span><strong>{quote?money(quote.fee):'A calcular'}</strong></div>}{discount>0&&!invalidDiscount&&<div className="line"><span>Desconto manual</span><strong>− {money(discount)}</strong></div>}{activeRule&&currentPreview&&<div className="line"><span>Desconto do cupom</span><strong>− {money(currentPreview.discount)}</strong></div>}{activeRule&&!waitingPrice&&<div className="line"><span>{priceAdjustment>0?'Acréscimo':'Desconto'} no pagamento ({Math.abs(activeRule.adjustment_bps/100).toLocaleString('pt-BR')}%)</span><strong>{money(priceAdjustment)}</strong></div>}{waitingPrice&&<small role="status">{previewError||'Calculando valor com cupom…'}</small>}<div className="line mn-pos-total"><b>Total do pedido</b><strong>{money(amount)}</strong></div>{coupon&&<small>O cupom será validado e o valor final calculado no servidor.</small>}</div>
 <div className="mn-pos-payment"><h4><CreditCard size={19}/> Pagamento</h4> <label><span className="mn-pos-sr-only">Pagamento</span><select value={payment} onChange={e=>{setPayment(e.target.value);setChange('');setCoupon('');setManualDiscount('')}}><option value="">Selecione</option>{availablePayments.filter(x=>x!=='fiado').map(m=><option key={m} value={m}>{methods[m]||m}</option>)}{!delivery&&fiado.length>0&&<option value="fiado">Fiado autorizado</option>}</select></label>
  {isCredit&&<label>Cliente autorizado<select value={credit} onChange={e=>setCredit(e.target.value)}><option value="">Selecione</option>{fiado.map(c=><option key={c.id} value={c.id}>{c.name} · {money(c.available)} disponíveis</option>)}</select></label>}
  {delivery&&<><label>Endereço completo<input required placeholder="Rua, número, bairro, cidade, UF, CEP" value={address} onChange={e=>setAddress(e.target.value)}/></label><p role="status">{quoting?'Calculando frete…':quote?'Taxa de entrega: '+money(quote.fee)+(Number.isInteger(quote.delivery_min_minutes)&&Number.isInteger(quote.delivery_max_minutes)?' · Previsão: '+quote.delivery_min_minutes+'–'+quote.delivery_max_minutes+' min':''):'Informe o endereço para calcular o frete.'}</p></>}
 {payment==='dinheiro'&&<label>Troco para (opcional)<input type="number" min="0" step="0.01" value={change} onChange={e=>setChange(e.target.value)}/></label>}
 {isCredit&&type==='balcao'&&<label>Desconto manual (R$)<input type="number" min="0" step="0.01" value={manualDiscount} onChange={e=>setManualDiscount(e.target.value)}/><small>Concedido pela loja, sem cupom ou benefício do Fideliza+.</small></label>}
 {loyalty&&!isCredit&&<label>Cupom (opcional)<input value={coupon} onChange={e=>setCoupon(e.target.value)}/></label>}
 {!delivery&&externalPayment&&<><p>Receba o pagamento fora do Pitacco. Confirme somente após a aprovação ou recebimento.</p>{coupon?<small>Confirme o pagamento após o cálculo definitivo do cupom.</small>:<label><span><input type="checkbox" checked={received} onChange={e=>setReceived(e.target.checked)}/> Pagamento recebido</span></label>}</>}
 </div>
 <button type="submit" className="mn-pos-submit" disabled={busy||!cart.length||!payment||invalidDiscount||waitingPrice||(delivery&&!quote)}><Check size={22}/>{busy?'Registrando…':'Finalizar Pedido'}</button></div></div>
 </div>
 <button className="mn-pos-mobile-cart" type="button" onClick={openSummary}><ShoppingCart size={19}/> Ver itens do pedido ({itemCount}) <strong>{money(amount)}</strong><ChevronUp size={18}/></button>
  {product&&<div className="mn-pos-product-modal" role="dialog" aria-modal="true" aria-label="Configurar produto"><div className="mn-pos-options"><div className="mn-pos-option-heading"><h4>{product.name}</h4><button type="button" className="secondary" aria-label="Fechar produto" onClick={()=>setProduct(null)}><X size={20}/></button></div>{product.pizza_config?<><label>Quantidade<input type='number' min='1' max='20' step='1' value={quantity} onChange={e=>setQuantity(Math.max(1,Math.min(20,Math.trunc(Number(e.target.value)||1))))}/></label><PizzaBuilder key={product.id} config={product.pizza_config} onConfirm={addPizza}/></>:<>{(product.option_groups||[]).map(g=><fieldset key={g.id}><legend>{g.name} · {g.min||0} a {g.max??100}</legend>{(g.options||[]).map(o=><label key={o.id}><input type="checkbox" checked={chosen.includes(o.id)} disabled={!chosen.includes(o.id)&&(g.options||[]).filter(x=>chosen.includes(x.id)).length>=Number(g.max??100)} onChange={e=>setChosen(v=>e.target.checked?[...v,o.id]:v.filter(x=>x!==o.id))}/>{o.name} · {money(o.price)}</label>)}</fieldset>)}<label>Quantidade<input type="number" min="1" max="20" value={quantity} onChange={e=>setQuantity(Math.max(1,Math.min(20,Number(e.target.value)||1)))}/></label><button type="button" disabled={!validProduct} onClick={add}>Adicionar ao pedido</button></>}</div></div>}
 </fieldset></form></section>
}
