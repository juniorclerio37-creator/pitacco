import React,{useEffect,useMemo,useRef,useState} from 'react';
import PizzaBuilder from './PizzaBuilder.jsx';
import {quotePizzaSelection} from './pizzaPricing.mjs';
const money=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const methods={dinheiro:'Dinheiro',pix_manual:'Pix manual',pix:'Pix',cartao:'Cartão',cartao_entrega:'Cartão na entrega',cartao_na_entrega:'Cartão na entrega',credit_card:'Crédito',debit_card:'Débito'};
const id=()=>crypto.randomUUID();
export default function MerchantNewOrder({client,storeId,onNavigate}){
 const [menu,setMenu]=useState(null),[loyalty,setLoyalty]=useState(false),[fiado,setFiado]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[result,setResult]=useState(null);
 const [name,setName]=useState(''),[phone,setPhone]=useState(''),[search,setSearch]=useState(''),[customers,setCustomers]=useState([]),[type,setType]=useState('balcao'),[payment,setPayment]=useState(''),[address,setAddress]=useState(''),[notes,setNotes]=useState(''),[change,setChange]=useState(''),[coupon,setCoupon]=useState(''),[credit,setCredit]=useState(''),[cart,setCart]=useState([]),[product,setProduct]=useState(null),[chosen,setChosen]=useState([]),[quantity,setQuantity]=useState(1),[quote,setQuote]=useState(null),[quoting,setQuoting]=useState(false);
 const [manualDiscount,setManualDiscount]=useState('');
 const request=useRef(id()),lock=useRef(false);
 async function rpc(n,args){const r=await client.rpc(n,args);if(r.error)throw r.error;if(r.data?.error)throw Error(r.data.error);return r.data}
 useEffect(()=>{let live=true;(async()=>{try{
  const r=await client.from('public_menu_settings').select('slug,enabled').eq('store_id',storeId).maybeSingle();if(r.error)throw r.error;
  if(!r.data?.enabled)throw Error('O cardápio digital precisa estar publicado para este fluxo integrado.');
  const data=await rpc('get_public_menu',{p_slug:r.data.slug});
  const [program,creditData]=await Promise.all([client.rpc('pitacco_loyalty_program',{p_slug:r.data.slug}),client.rpc('pitacco_fiado_overview',{p_store:storeId})]);
  if(!live)return;if(program.error)throw program.error;
  setMenu(data);setType(data.store.pickup_enabled?'balcao':'entrega');setLoyalty(!!program.data);setFiado((creditData.data?.customers||[]).filter(c=>c.enabled));setPayment((data.store.payment_methods||[])[0]||'');
 }catch(e){if(live)setError(e.message||String(e))}finally{if(live)setLoading(false)}})();return()=>{live=false}},[client,storeId]);
 useEffect(()=>{let live=true;if(search.trim().length<2){setCustomers([]);return}const t=setTimeout(()=>{client.rpc('pitacco_merchant_customers',{p_store:storeId,p_query:search,p_offset:0}).then(r=>{if(live&&!r.error)setCustomers(r.data?.rows||[])})},300);return()=>{live=false;clearTimeout(t)}},[client,storeId,search]);
 const delivery=type==='entrega',isCredit=payment==='fiado';
 const [searchProduct,setSearchProduct]=useState('');
 const products=menu?.products||[],shown=products.filter(p=>String(p.name+' '+(p.category||'')).toLowerCase().includes(searchProduct.toLowerCase()));
 const subtotal=useMemo(()=>cart.reduce((sum,l)=>sum+l.quantity*l.unit,0),[cart]);
 const discount=isCredit&&type==='balcao'?Number(manualDiscount||0):0;
 const invalidDiscount=!Number.isFinite(discount)||discount<0||(discount>0&&discount>=subtotal);
 const amount=subtotal+(delivery?Number(quote?.fee||0):0)-(invalidDiscount?0:discount);
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
 async function submit(e){e.preventDefault();if(lock.current||!cart.length||!payment)return;
 if(delivery&&(!quote?.quote_id||new Date(quote.expires_at)<=new Date())){setError('É necessário recalcular o frete antes de confirmar.');return}
 if(isCredit&&(!credit||delivery)){setError('Selecione um cliente autorizado. Fiado neste fluxo está disponível para balcão e retirada.');return}
 if(!isCredit&&(name.trim().length<2||phone.replace(/\D/g,'').length<10)){setError('Informe nome e telefone com DDD.');return}
 if(payment==='dinheiro'&&change&&(!Number.isFinite(Number(change))||Number(change)<amount)){setError('Informe um valor para troco igual ou maior que o total estimado.');return}
 if(invalidDiscount){setError('O desconto manual deve ser inferior ao subtotal.');return}
 lock.current=true;setBusy(true);setError('');
 try{
 const items=cart.map(({product_id,quantity,options})=>({product_id,quantity,options}));
 const note=notes.trim()+(payment==='dinheiro'&&change?' Troco para: R$ '+Number(change).toFixed(2):'');
 const data=isCredit&&type==='balcao'?await rpc('pitacco_fiado_balcao_discount',{p_store:storeId,p_customer:credit,p_request:request.current,p_items:items,p_note:notes.trim(),p_discount:discount}):await rpc('pitacco_merchant_create_checkout',{p_store:storeId,p_request:request.current,p_sale_mode:type,p_customer:isCredit?'':name.trim(),p_phone:isCredit?'':phone,p_address:delivery?address.trim():'',p_items:items,p_payment:payment,p_notes:isCredit?notes.trim():note,p_coupon:isCredit?'':coupon.trim(),p_quote:delivery?quote.quote_id:null,p_fiado_customer:isCredit?credit:null});
 if(!data?.order_id)throw Error('Pedido não confirmado pelo servidor. Verifique antes de repetir.');
 setResult(data);
 }catch(e){setError(e.message||String(e))}finally{lock.current=false;setBusy(false)}}
 if(loading)return <section className="panel">Carregando cardápio da loja…</section>;
 if(!menu)return <section className="panel"><h3>Novo Pedido</h3><p role="alert">{error}</p><button onClick={()=>onNavigate('Cozinha e expedição')}>Ir ao lançamento manual existente</button></section>;
 if(result)return <section className="panel" role="status"><h3>Pedido registrado</h3><p>#{result.order_id.slice(0,8)} · {money(result.total)}</p><p>Acompanhe o aceite, preparo e pagamento em Pedidos.</p><button onClick={()=>onNavigate('Pedidos')}>Abrir pedidos</button></section>;
 return <section className="panel mn-pos" aria-label="Novo pedido">
 <h2>Novo Pedido</h2><p>Selecione os itens do cardápio da loja. Preços e complementos são conferidos pelo servidor.</p>
 {error&&<p role="alert" className="notice error">{error}</p>}
 <form onSubmit={submit}><fieldset disabled={busy} className="mn-pos-fieldset">
 <div className="mn-pos-grid"><div>
 <h3>Produtos</h3><input placeholder="Buscar produto ou categoria" value={searchProduct} onChange={e=>setSearchProduct(e.target.value)}/>
 <div className="mn-pos-products">{shown.map(p=><button key={p.id} type="button" className="secondary" onClick={()=>{setProduct(p);setChosen([]);setQuantity(1)}}><span>{p.name}</span><strong>{p.pizza_config?'A partir de ':''}{money(p.price)}</strong></button>)}</div>
 {product&&<div className="mn-pos-options"><h4>{product.name}</h4>{product.pizza_config?<><label>Quantidade<input type='number' min='1' max='20' step='1' value={quantity} onChange={e=>setQuantity(Math.max(1,Math.min(20,Math.trunc(Number(e.target.value)||1))))}/></label><PizzaBuilder key={product.id} config={product.pizza_config} onConfirm={addPizza}/></>:<>{(product.option_groups||[]).map(g=><fieldset key={g.id}><legend>{g.name} · {g.min||0} a {g.max??100}</legend>{(g.options||[]).map(o=><label key={o.id}><input type="checkbox" checked={chosen.includes(o.id)} disabled={!chosen.includes(o.id)&&(g.options||[]).filter(x=>chosen.includes(x.id)).length>=Number(g.max??100)} onChange={e=>setChosen(v=>e.target.checked?[...v,o.id]:v.filter(x=>x!==o.id))}/>{o.name} · {money(o.price)}</label>)}</fieldset>)}<label>Quantidade<input type="number" min="1" max="20" value={quantity} onChange={e=>setQuantity(Math.max(1,Math.min(20,Number(e.target.value)||1)))}/></label><button type="button" disabled={!validProduct} onClick={add}>Adicionar ao pedido</button></>}</div>}
 <h3>Itens do pedido</h3>{cart.length===0&&<p>Nenhum item adicionado.</p>}{cart.map(l=><div className="line" key={l.key}><span>{l.quantity} × {l.name}<small>{l.names.join(', ')}</small></span><strong>{money(l.unit*l.quantity)}</strong><button type="button" className="secondary" onClick={()=>setCart(v=>v.filter(x=>x.key!==l.key))}>Remover</button></div>)}
 </div><div>
 <h3>Atendimento</h3><label>Modalidade<select value={type} onChange={e=>{setType(e.target.value);setManualDiscount('');if(e.target.value==='entrega'&&isCredit)setPayment(menu.store.payment_methods[0]||'')}}>{menu.store.pickup_enabled&&<><option value="balcao">Balcão</option><option value="retirada">Retirada</option></>}{menu.store.delivery_enabled&&<option value="entrega">Entrega</option>}</select></label>
 <label>Pagamento<select value={payment} onChange={e=>{setPayment(e.target.value);setChange('');setCoupon('');setManualDiscount('')}}><option value="">Selecione</option>{(menu.store.payment_methods||[]).filter(x=>x!=='fiado').map(m=><option key={m} value={m}>{methods[m]||m}</option>)}{!delivery&&fiado.length>0&&<option value="fiado">Fiado autorizado</option>}</select></label>
 {isCredit?<label>Cliente autorizado<select value={credit} onChange={e=>setCredit(e.target.value)}><option value="">Selecione</option>{fiado.map(c=><option key={c.id} value={c.id}>{c.name} · {money(c.available)} disponíveis</option>)}</select></label>:<>
 <label>Buscar cliente<input placeholder="Nome ou telefone" value={search} onChange={e=>setSearch(e.target.value)}/></label>{customers.filter(c=>c.phone).map(c=><button key={c.customer_key} type="button" className="secondary" onClick={()=>{setName(c.name);setPhone(c.phone);setSearch('');setCustomers([])}}>{c.name} · {c.phone}</button>)}
 <label>Nome<input required value={name} onChange={e=>setName(e.target.value)}/></label><label>Telefone com DDD<input required type="tel" value={phone} onChange={e=>setPhone(e.target.value)}/></label>
 </>}
 {delivery&&<><label>Endereço completo<input required placeholder="Rua, número, bairro, cidade, UF, CEP" value={address} onChange={e=>setAddress(e.target.value)}/></label><p role="status">{quoting?'Calculando frete…':quote?'Taxa de entrega: '+money(quote.fee):'Informe o endereço para calcular o frete.'}</p></>}
 {payment==='dinheiro'&&<label>Troco para (opcional)<input type="number" min="0" step="0.01" value={change} onChange={e=>setChange(e.target.value)}/></label>}
 {isCredit&&type==='balcao'&&<label>Desconto manual (R$)<input type="number" min="0" step="0.01" value={manualDiscount} onChange={e=>setManualDiscount(e.target.value)}/><small>Concedido pela loja, sem cupom ou benefício do Fideliza+.</small></label>}
 {loyalty&&!isCredit&&<label>Cupom (opcional)<input value={coupon} onChange={e=>setCoupon(e.target.value)}/></label>}
 <label>Observações<textarea maxLength={900} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
 <div className="line"><span>Subtotal</span><strong>{money(subtotal)}</strong></div><div className="line"><span>Entrega</span><strong>{delivery?(quote?money(quote.fee):'A calcular'):money(0)}</strong></div>
 {discount>0&&!invalidDiscount&&<div className="line"><span>Desconto manual</span><strong>− {money(discount)}</strong></div>}
 <div className="line"><b>Total estimado</b><strong>{money(amount)}</strong></div>{coupon&&<small>O cupom será validado e o valor final calculado no servidor.</small>}
 <button disabled={busy||!cart.length||!payment||invalidDiscount||(delivery&&!quote)}>{busy?'Registrando…':'Confirmar pedido'}</button>
 </div></div></fieldset></form></section>
}
