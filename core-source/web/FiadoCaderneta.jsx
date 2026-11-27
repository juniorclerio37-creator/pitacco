import React,{useEffect,useMemo,useState} from 'react';
import './fiado.css';

const brl=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const fmt=n=>brl.format(Number(n||0));
const day=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric'});
const initial={name:'',phone:'',limit:'100',enabled:true,due_days:7,approval_mode:'manual',block_overdue:true,pin:'',pin_confirm:''};

export default function FiadoCaderneta({client,storeId,onNavigate,initialTab='clientes',navigationKey,sidebarOnly=false}){
 const [overview,setOverview]=useState(null),[products,setProducts]=useState([]);
 const [groups,setGroups]=useState([]),[options,setOptions]=useState([]);
 const [selected,setSelected]=useState(''),[form,setForm]=useState(initial);
 const [tab,setTab]=useState(initialTab),[items,setItems]=useState({});
 useEffect(()=>setTab(initialTab),[initialTab,navigationKey]);
 const [choices,setChoices]=useState({}),[note,setNote]=useState(''),[manualDiscount,setManualDiscount]=useState('');
 const [paymentAmount,setPaymentAmount]=useState(''),[paymentMethod,setPaymentMethod]=useState('pix');
 const [paymentNote,setPaymentNote]=useState(''),[paymentRequestKey,setPaymentRequestKey]=useState(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [reload,setReload]=useState(0),[requestKey,setRequestKey]=useState(null);
 const customers=overview?.customers||[],charges=overview?.charges||[],payments=overview?.payments||[];
 const customer=customers.find(x=>x.id===selected)||null;
 useEffect(()=>{if(customer)setForm({name:customer.name,phone:customer.phone,limit:String(customer.limit),enabled:customer.enabled,due_days:customer.due_days,approval_mode:customer.approval_mode,block_overdue:customer.block_overdue,pin:'',pin_confirm:''})},[storeId,customer?.id]);

 const customerCharges=charges.filter(x=>x.customer_id===selected);
 const reserved=customerCharges.filter(x=>x.state==='reserved').reduce((a,x)=>a+Number(x.amount)-Number(x.paid),0);
 const due=customerCharges.filter(x=>x.state==='open').reduce((a,x)=>a+Number(x.amount)-Number(x.paid),0);
 const totals=useMemo(()=>({
   used:customers.reduce((sum,c)=>sum+Number(c.used||0),0),
   receivable:charges.filter(c=>c.state==='open').reduce((sum,c)=>sum+Number(c.amount)-Number(c.paid),0),
   overdue:charges.filter(c=>c.state==='open'&&new Date(c.due_at)<new Date()).reduce((sum,c)=>sum+Number(c.amount)-Number(c.paid),0),
   received:payments.reduce((sum,c)=>sum+Number(c.amount),0)
 }),[customers,charges,payments]);
 const cart=useMemo(()=>products.filter(p=>Number(items[p.id])>0).map(p=>({
  product_id:p.id,quantity:Number(items[p.id]),options:options.filter(o=>choices[o.id]&&groups.some(g=>g.id===o.group_id&&g.product_id===p.id)).map(o=>o.id)
 })),[products,items,choices,options,groups]);
 const cartTotal=useMemo(()=>cart.reduce((sum,item)=>{
  const p=products.find(x=>x.id===item.product_id);
  return sum+item.quantity*(Number(p?.price||0)+item.options.reduce((a,id)=>a+Number(options.find(x=>x.id===id)?.additional_price||0),0));
 },0),[cart,products,options]);
 useEffect(()=>{
  let live=true;setLoading(true);setError('');
  const get=async()=>{
   try{
    const [wallet,productsResult,groupResult,optionResult]=await Promise.all([
     client.rpc('pitacco_fiado_overview',{p_store:storeId}),
     client.from('products').select('id,name,price').eq('store_id',storeId).eq('menu_active',true).order('name').limit(150),
     client.from('product_option_groups').select('id,product_id,name,min_select,max_select').eq('store_id',storeId).limit(200),
     client.from('product_options').select('id,group_id,name,additional_price,available').eq('store_id',storeId).limit(500)
    ]);
    if(wallet.error)throw wallet.error;
    if(!live)return;
    setOverview(wallet.data);setProducts(productsResult.data||[]);
    setGroups(groupResult.data||[]);setOptions(optionResult.data||[]);
    setSelected(old=>wallet.data?.customers?.some(x=>x.id===old)?old:wallet.data?.customers?.[0]?.id||'');
   }catch(e){if(live)setError(e.message||'Não foi possível consultar a caderneta.');}
   finally{if(live)setLoading(false);}
  };
  void get();
  return()=>{live=false};
 },[client,storeId,reload]);
 function reloadData(message=''){
  setNotice(message);setReload(n=>n+1);
 }
 async function run(action){
  if(busy)return;
  setBusy(true);setError('');setNotice('');
  try{await action()}
  catch(e){setError(e.message||'A operação não pôde ser concluída.')}
  finally{setBusy(false);}
 }
 async function rpc(name,params){const {data,error}=await client.rpc(name,params);if(error)throw error;return data;}
 function selectCustomer(id){
  setSelected(id);setPaymentAmount('');setPaymentRequestKey(null);
  const target=customers.find(x=>x.id===id);
  if(target)setForm({name:target.name,phone:target.phone,limit:String(target.limit),
   enabled:target.enabled,due_days:target.due_days,
   approval_mode:target.approval_mode,block_overdue:target.block_overdue,pin:'',pin_confirm:''});
 }
 function newCustomer(){setSelected('');setForm(initial);setTab('clientes')}
 function saveCustomer(e){e.preventDefault();void run(async()=>{
  if(form.pin&&form.pin!==form.pin_confirm)throw Error('Confirme o mesmo PIN de seis dígitos.');
  if(form.pin&&!/^[0-9]{6}$/.test(form.pin))throw Error('O PIN deve ter exatamente seis dígitos numéricos.');
  const id=await rpc('pitacco_fiado_save_customer_pin',{
   p_store:storeId,p_name:form.name,p_phone:form.phone,p_limit:Number(form.limit),
   p_enabled:customer?customer.enabled:form.enabled,p_due_days:Number(form.due_days),
   p_mode:form.approval_mode,p_block_overdue:form.block_overdue,
   p_pin:form.pin||null});
  setSelected(id);setForm(previous=>({...previous,pin:'',pin_confirm:''}));reloadData('Cliente salvo. A loja autoriza cada compra, ou pode liberar aprovação automática para este cliente.');
 })}
 function changeCustomerAuthorization(target){
  if(!target||busy||loading)return;
  const enabled=!target.enabled;
  if(!window.confirm(enabled?'Liberar novas compras fiadas para '+target.name+'? Os limites e bloqueios por atraso continuam valendo.':'Bloquear novas compras fiadas de '+target.name+'? As dívidas e pedidos existentes serão preservados.'))return;
  void run(async()=>{
   const result=await rpc('pitacco_fiado_set_customer_enabled',{p_store:storeId,p_customer:target.id,p_enabled:enabled});
   if(result!==enabled)throw Error('Não foi possível confirmar a alteração de autorização.');
   setOverview(previous=>previous?{...previous,customers:previous.customers.map(c=>c.id===target.id?{...c,enabled}:c)}:previous);
   setForm(previous=>({...previous,enabled}));
   reloadData(enabled?'Fiado liberado para este cliente. As demais regras continuam valendo.':'Fiado bloqueado manualmente. Dívidas e recebimentos permanecem disponíveis.');
  });
 }
 function toggle(e){void run(async()=>{
  const enabled=e.target.checked;
  await rpc('pitacco_fiado_toggle',{p_store:storeId,p_enabled:enabled});
  reloadData(enabled?'Caderneta ativada para esta loja.':'Novas compras fiadas desativadas nesta loja.');
 })}
 function pay(e){e.preventDefault();if(!customer)return;void run(async()=>{
  // Reutilize a MESMA chave depois de timeout: evita duas baixas da dívida.
  const request=paymentRequestKey||crypto.randomUUID();
  if(!paymentRequestKey)setPaymentRequestKey(request);
  const result=await rpc('pitacco_fiado_receive',{
   p_store:storeId,p_customer:customer.id,p_amount:Number(paymentAmount),
   p_method:paymentMethod,p_request:request,p_note:paymentNote});
  setPaymentRequestKey(null);setPaymentAmount('');setPaymentNote('');
  reloadData('Pagamento registrado. Saldo restante: '+fmt(result.remaining));
 })}
 function approve(charge,approved){void run(async()=>{
  await rpc('pitacco_fiado_approve',{p_store:storeId,p_order:charge.order_id,p_approve:approved});
  reloadData(approved?'Fiado autorizado. O pedido pode seguir para aceite.':'Fiado recusado; crédito reservado liberado.');
 })}
 function updateQty(id,value){
  setRequestKey(null);
  setItems(old=>({...old,[id]:Math.max(0,Math.min(20,Math.trunc(Number(value)||0)))}));
 }
 function toggleOption(id,checked){
  setRequestKey(null);
  setChoices(old=>({...old,[id]:checked}));
 }
 function createCounter(e){e.preventDefault();if(!selected||!customer?.enabled||!overview?.enabled||!cart.length)return;
  void run(async()=>{
   // Uma chave é mantida se a confirmação de rede falhar; o backend é idempotente.
   const key=requestKey||crypto.randomUUID();
   if(!requestKey)setRequestKey(key);
   const result=await rpc('pitacco_fiado_balcao_discount',{
    p_store:storeId,p_customer:selected,p_request:key,p_items:cart,p_note:note,p_discount:Number(manualDiscount||0)});
   setRequestKey(null);setItems({});setChoices({});setNote('');setManualDiscount('');
   reloadData('Pedido de balcão '+result.order_id+' registrado no fiado por '+fmt(result.total)+'.');
   if(sidebarOnly)onNavigate?.('Contas a receber');else setTab('pedidos');
  });
 }
 const pending=charges.filter(x=>x.approval_required&&!x.approved&&x.state==='reserved');
 return <section className="fiado-page" aria-label="Fiado e caderneta digital">
  <header className="fiado-header">
   <div><h2>Fiado / Caderneta Digital</h2><p>A loja autoriza pedidos sem chave. Escolha aprovação manual ou automática individualmente para cada cliente.</p></div>
   <label className="fiado-switch">
    <input type="checkbox" checked={!!overview?.enabled} onChange={toggle} disabled={busy||loading}/>
    <span>{overview?.enabled?'Fiado ativo na loja':'Fiado bloqueado na loja — ativar'}</span>
   </label>
  </header>
  {error&&<p role="alert" className="fiado-alert">{error}</p>}
  {notice&&<p role="status" className="fiado-info">{notice}</p>}

  <div className="fiado-metrics">
   <article><small>Crédito utilizado</small><strong>{fmt(totals.used)}</strong></article>
   <article><small>Contas a receber</small><strong>{fmt(totals.receivable)}</strong></article>
   <article><small>Vencido</small><strong>{fmt(totals.overdue)}</strong></article>
   <article><small>Recebimentos registrados</small><strong>{fmt(totals.received)}</strong></article>
  </div>
  {!sidebarOnly&&<nav className="fiado-tabs" aria-label="Áreas da caderneta">
   {[['clientes','Clientes'],['pedidos','Extrato e cobranças'],['balcao','Novo pedido de balcão']].map(([id,label])=>
    <button type="button" key={id} className={tab===id?'active':''} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}
  </nav>}
  {loading&&<p role="status">Consultando caderneta da loja…</p>}
  {!loading&&tab==='clientes'&&<div className="fiado-columns">
   <section className="panel fiado-customer-list">
    <div className="fiado-section-heading"><h3>Clientes autorizados</h3><button type="button" className="secondary" onClick={newCustomer}>+ Novo cliente</button></div>
    {!customers.length&&<p>Nenhum cliente cadastrado para fiado.</p>}
    {customers.map(c=><button type="button" className={'fiado-customer'+(selected===c.id?' selected':'')}
      key={c.id} onClick={()=>selectCustomer(c.id)}>
      <strong>{c.name}</strong><span>{c.phone}</span>
      <span>{c.enabled?'Autorizado':'Bloqueado manualmente'} · {c.pin_set?'PIN cadastrado':'PIN pendente'} · Em uso {fmt(c.used)} · Disponível {fmt(c.available)}</span>
      {c.overdue&&<em>Pagamento vencido</em>}
     </button>)}
   </section>
   <section className="panel">
    <h3>{selected?'Configurações do cliente':'Cadastrar cliente'}</h3>
    {customer&&<div className={'fiado-manual-status '+(customer.enabled?'is-enabled':'is-blocked')}>
      <div><strong>{customer.enabled?'Fiado autorizado':'Fiado bloqueado manualmente'}</strong><p>{customer.enabled?'O gestor pode suspender novas compras a qualquer momento.':'Novas compras fiadas estão bloqueadas até a loja liberar novamente.'} Dívidas, histórico e recebimentos são preservados.</p></div>
      <button type="button" disabled={busy||loading} className={customer.enabled?'fiado-block-button':'fiado-unblock-button'} onClick={()=>changeCustomerAuthorization(customer)}>{customer.enabled?'Bloquear fiado':'Desbloquear fiado'}</button>
    </div>}
    <form className="fiado-form" onSubmit={saveCustomer}>
     <label>Nome<input required minLength={2} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
     <label>Telefone com DDD<input required inputMode="tel" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
     <label>PIN pessoal de 6 dígitos<input type="password" inputMode="numeric" autoComplete="off" minLength={6} maxLength={6} pattern="[0-9]{6}"
       required={!selected||!customer?.pin_set} value={form.pin}
       onChange={e=>setForm({...form,pin:e.target.value.replace(/\D/g,'').slice(0,6)})} />
       <small>{selected&&customer?.pin_set?'PIN cadastrado. Deixe em branco para manter ou informe outro para redefinir.':'Defina o PIN junto com o cliente, presencialmente ou por atendimento confirmado. O PIN não aparece após salvar.'}</small></label>
     <label>Confirme o PIN<input type="password" inputMode="numeric" autoComplete="off" minLength={6} maxLength={6} pattern="[0-9]{6}"
       required={Boolean(form.pin)} value={form.pin_confirm}
       onChange={e=>setForm({...form,pin_confirm:e.target.value.replace(/\D/g,'').slice(0,6)})} /></label>
     <label>Limite individual (R$)<input required type="number" min="0" max="100000" step="0.01" value={form.limit} onChange={e=>setForm({...form,limit:e.target.value})}/></label>
     <label>Prazo de pagamento (dias)<input required type="number" min="1" max="365" value={form.due_days} onChange={e=>setForm({...form,due_days:e.target.value})}/></label>
     <label>Aprovação<select value={form.approval_mode} onChange={e=>setForm({...form,approval_mode:e.target.value})}>
      <option value="manual">Manual — a loja autoriza cada pedido</option><option value="automatic">Automática — somente este cliente</option></select></label>
     {!customer&&<label className="fiado-check"><input type="checkbox" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked})}/>Permitir novas compras</label>}
     <label className="fiado-check"><input type="checkbox" checked={form.block_overdue} onChange={e=>setForm({...form,block_overdue:e.target.checked})}/>Bloquear fiado quando houver dívida vencida</label>
     <button disabled={busy}>Salvar cadastro e regras</button>
    </form>
    <div className="fiado-customer-actions">
     <p><strong>Como funciona:</strong> o cliente informa o telefone e seu PIN pessoal no cardápio e escolhe Fiado. No modo manual, a loja confirma ou recusa o pedido antes do preparo. No automático, a compra é autorizada imediatamente somente para este cliente, respeitando o limite e os bloqueios definidos aqui.</p>
     {form.approval_mode==='automatic'&&<p>Ao liberar aprovação automática, qualquer pessoa que saiba o telefone e o PIN poderá usar o crédito dentro das regras. Ative apenas para clientes em que você confia.</p>}
    </div>
   </section>
  </div>}
  {!loading&&tab==='pedidos'&&<div className="fiado-columns">
   <section className="panel">
    <h3>Pedidos na caderneta</h3>
    {pending.length>0&&<div className="fiado-pending"><strong>{pending.length} pedido(s) aguardando aprovação manual</strong>
     {pending.map(p=><article key={p.order_id}><span>{customers.find(c=>c.id===p.customer_id)?.name||'Cliente'} · Pedido #{p.order_id.slice(0,8)} · {fmt(p.amount)}</span>
      <div><button type="button" disabled={busy} onClick={()=>approve(p,true)}>Autorizar</button>
       <button type="button" disabled={busy} className="secondary" onClick={()=>approve(p,false)}>Recusar</button></div>
     </article>)}
    </div>}
    <div className="fiado-ledger">
     <table><thead><tr><th>Cliente</th><th>Pedido</th><th>Valor</th><th>Pago</th><th>Vencimento</th><th>Situação</th></tr></thead>
      <tbody>{charges.map(c=><tr key={c.order_id}>
       <td>{customers.find(x=>x.id===c.customer_id)?.name||'Cliente'}</td>
       <td>#{c.order_id.slice(0,8)}</td><td>{fmt(c.amount)}</td><td>{fmt(c.paid)}</td>
       <td>{day.format(new Date(c.due_at))}</td>
       <td>{c.state==='reserved'?'Reservado':c.state==='open'?'Em aberto':c.state==='settled'?'Quitado':'Cancelado'}</td>
      </tr>)}</tbody>
     </table>
     {!charges.length&&<p>Nenhum pedido fiado registrado.</p>}
    </div>
   </section>
   <section className="panel">
    <h3>Registrar recebimento</h3>
    <label>Cliente<select value={selected} onChange={e=>selectCustomer(e.target.value)}>
     <option value="">Selecione</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    {customer&&<div className="fiado-summary">
     <p><strong>Em aberto:</strong> {fmt(due)}</p><p><strong>Reservado:</strong> {fmt(reserved)}</p>
     <p><strong>Limite disponível:</strong> {fmt(customer.available)}</p>
    </div>}
    <form className="fiado-form" onSubmit={pay}>
     <label>Valor recebido<input type="number" min="0.01" step="0.01" required
      value={paymentAmount} onChange={e=>{setPaymentRequestKey(null);setPaymentAmount(e.target.value)}}/></label>
     <label>Forma de pagamento<select value={paymentMethod} onChange={e=>{setPaymentRequestKey(null);setPaymentMethod(e.target.value)}}>
      <option value="pix">Pix</option><option value="dinheiro">Dinheiro</option>
      <option value="cartao">Cartão</option><option value="outro">Outro</option></select></label>
     <label>Observações<input maxLength={500} value={paymentNote} onChange={e=>{setPaymentRequestKey(null);setPaymentNote(e.target.value)}}/></label>
     <button disabled={busy||!customer||!(due>0)}>Registrar pagamento</button>
    </form>
    <h4>Recebimentos anteriores</h4>
    <div className="fiado-payments">
     {payments.filter(x=>x.customer_id===selected).map(p=><p key={p.id}>{day.format(new Date(p.created_at))} · {p.method} <strong>{fmt(p.amount)}</strong></p>)}
    </div>
   </section>
  </div>}
  {!loading&&tab==='balcao'&&<div className="fiado-columns fiado-balcao">
   <section className="panel">
    <h3>Novo pedido no balcão</h3>
    <p>O pedido entra normalmente em Pedidos. A cobrança será lançada somente na caderneta.</p>
    <label>Cliente autorizado<select value={selected} onChange={e=>selectCustomer(e.target.value)}>
     <option value="">Selecione um cliente</option>
     {customers.filter(c=>c.enabled).map(c=><option value={c.id} key={c.id}>{c.name} · {fmt(c.available)} disponíveis</option>)}
    </select></label>
    <div className="fiado-products">
     {products.map(p=><article key={p.id}>
      <div><strong>{p.name}</strong><small>{fmt(p.price)} cada</small></div>
      <label>Quantidade<input min="0" max="20" step="1" type="number" value={items[p.id]||0}
       onChange={e=>updateQty(p.id,e.target.value)}/></label>
      {Number(items[p.id])>0&&groups.filter(g=>g.product_id===p.id).map(g=><fieldset key={g.id}>
       <legend>{g.name} · mínimo {g.min_select}, máximo {g.max_select}</legend>
       {options.filter(o=>o.group_id===g.id&&o.available!==false).map(o=><label key={o.id} className="fiado-check">
        <input type="checkbox" checked={!!choices[o.id]} onChange={e=>toggleOption(o.id,e.target.checked)}/>
        {o.name} {Number(o.additional_price)?' + '+fmt(o.additional_price):''}</label>)}
      </fieldset>)}
     </article>)}
    </div>
   </section>
   <section className="panel">
    <h3>Resumo da venda</h3>
    <p><strong>{customer?.name||'Nenhum cliente selecionado'}</strong></p>
    {cart.map(c=><p key={c.product_id}>{c.quantity} × {products.find(p=>p.id===c.product_id)?.name}</p>)}
    <p>Subtotal: {fmt(cartTotal)}</p>
    <h3>Total: {fmt(Math.max(0,cartTotal-Number(manualDiscount||0)))}</h3>
    <p>Disponível: {fmt(customer?.available)}. O limite é revalidado no servidor ao confirmar.</p>
    <form className="fiado-form" onSubmit={createCounter}>
     <label>Desconto manual (R$)<input type="number" min="0" step="0.01" value={manualDiscount} onChange={e=>setManualDiscount(e.target.value)}/><small>Exclusivo para venda de balcão. Não é cupom Fideliza+.</small></label>
     <label>Observações<input maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label>
     <button disabled={busy||!customer?.enabled||!overview?.enabled||!cart.length||!Number.isFinite(Number(manualDiscount||0))||Number(manualDiscount||0)<0||Number(manualDiscount||0)>=cartTotal||cartTotal-Number(manualDiscount||0)>Number(customer?.available)}>
      Finalizar pedido de balcão no fiado
     </button>
    </form>
    <button type="button" className="secondary" onClick={()=>onNavigate?.('Pedidos')}>Abrir gestor de pedidos</button>
   </section>
  </div>}
 </section>;
}
