import {Printer} from 'lucide-react';
import DeliveryDialog,{deliveryLabel} from './DeliveryDialog.jsx';
import {columns,orderStage,matchesOrder} from './orderBoard.mjs';
import React,{useEffect,useRef,useState} from 'react';
import {nativeAvailable,invoke,ingestJobs} from './printBridge.mjs';
const SOURCES=[['proprio','Cardápio próprio'],['ifood','iFood'],['99food','99Food'],['keeta','Keeta']];
const currency=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export default function Operations({client,storeId,view,manager,onNavigate}){
 const desktop=nativeAvailable(),[orders,setOrders]=useState([]),[settings,setSettings]=useState([]),[sectors,setSectors]=useState([]),[jobs,setJobs]=useState([]),[printers,setPrinters]=useState([]),[device,setDevice]=useState(''),[autoStart,setAutoStart]=useState(false),[status,setStatus]=useState('Conectando…'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[sound,setSound]=useState(false);
 const [settingsTab,setSettingsTab]=useState('Impressoras'),[orderFilter,setOrderFilter]=useState('board'),[query,setQuery]=useState(''),[deliveryRows,setDeliveryRows]=useState([]),[detail,setDetail]=useState(null),[dispatchOnly,setDispatchOnly]=useState(false),[courierRows,setCourierRows]=useState([]);
 const createRequest=useRef(crypto.randomUUID()), paymentRequest=useRef(crypto.randomUUID()), reprintRequests=useRef(new Map());
 const [paymentSummary,setPaymentSummary]=useState([]),[paymentOrder,setPaymentOrder]=useState(null),[paymentAmount,setPaymentAmount]=useState(''),[paymentMethod,setPaymentMethod]=useState('dinheiro'),[paymentReference,setPaymentReference]=useState('');
 const seen=useRef(new Set()),soundRef=useRef(false),notifySeen=useRef(new Set());
 useEffect(()=>{soundRef.current=sound},[sound]);
 const rpc=async(name,args)=>{const {data,error}=await client.rpc(name,args);if(error)throw error;return data};
 async function act(fn){setBusy(true);setError('');try{await fn()}catch(e){setError(e.message||String(e))}finally{setBusy(false)}}
 useEffect(()=>{
  if(!desktop)return;
  invoke('device_id').then(setDevice).catch(e=>setError(String(e)));
  invoke('list_printers').then(setPrinters).catch(e=>setError(String(e)));
  invoke('get_autostart').then(setAutoStart).catch(e=>setError(String(e)));
 },[desktop]);
 useEffect(()=>{
  if(!desktop||!storeId)return;
  invoke('set_active_store',{storeId:manager?storeId:null}).catch(e=>setError(String(e)));
  return()=>{invoke('set_active_store',{storeId:null}).catch(()=>{})};
 },[desktop,storeId,manager]);
 useEffect(()=>{
  if(!desktop||!manager||!storeId)return;
  let stopped=false,running=false;
  async function readLocal(){
   if(running||stopped)return;running=true;
   try{const local=await invoke('list_jobs');if(stopped)return;setJobs(local.filter(j=>j.store_id===storeId));
    for(const job of local.filter(j=>j.store_id===storeId&&['error','uncertain'].includes(j.state))){const key=`${job.id}:${job.state}`;if(!notifySeen.current.has(key)){notifySeen.current.add(key);invoke('notify',{message:'Falha de impressão. Consulte a fila do Pitacco.'}).catch(()=>{});}}
   }catch(e){if(!stopped)setError('Fila local: '+String(e))}finally{running=false}
  }
  void readLocal();const timer=setInterval(readLocal,2000);return()=>{stopped=true;clearInterval(timer)};
 },[desktop,manager,storeId]);
 useEffect(()=>{
  if(!storeId||!manager)return;
  let stopped=false,running=false,refreshAgain=false;
  setDetail(null);seen.current=new Set();notifySeen.current=new Set();setOrders([]);setJobs([]);setError('');
  async function refresh(){
   if(stopped)return;if(running){refreshAgain=true;return}running=true;
   try{
    const results=await Promise.all([
     client.from('orders').select('*').eq('store_id',storeId).in('status',['pending','accepted']).order('created_at',{ascending:false}).limit(100),
     client.from('acceptance_settings').select('*').eq('store_id',storeId),
     client.from('print_sectors').select('*').eq('store_id',storeId).order('sector'),
     client.from('deliveries').select('*').eq('store_id',storeId).not('order_id','is',null),
     client.from('couriers').select('id,name').eq('store_id',storeId),
     client.rpc('pitacco_store_payment_summary',{p_store:storeId})
    ]);
    for(const result of results)if(result.error)throw result.error;
    if(stopped)return;
    const incoming=results[0].data||[];
    const fresh=incoming.filter(o=>o.status==='pending'&&!seen.current.has(o.id));
    incoming.forEach(o=>seen.current.add(o.id));
    setPaymentSummary(results[5].data||[]);setOrders(incoming);setDeliveryRows(results[3].data||[]);setCourierRows(results[4].data||[]);setSettings(results[1].data||[]);setSectors(results[2].data||[]);setStatus('Conectado · sincronização ativa');
    if(fresh.length){
     if(desktop)invoke('notify',{message:`${fresh.length} pedido(s) aguardando aceite.`}).catch(e=>setError('Notificação: '+String(e)));
     else if(soundRef.current){try{const context=new AudioContext();const osc=context.createOscillator();osc.connect(context.destination);osc.start();osc.stop(context.currentTime+0.2);osc.onended=()=>context.close()}catch{}}
    }
    if(desktop&&device){
     const remote=await rpc('claim_print_jobs',{p_store:storeId,p_device:device});
     if(stopped)return;
     await ingestJobs({jobs:remote||[],device,call:invoke,ack:args=>rpc('ack_print_job',args)});
     const local=await invoke('list_jobs');
     if(stopped)return;
     setJobs(local.filter(j=>j.store_id===storeId));
     for(const job of local.filter(j=>j.store_id===storeId)){
      if(['submitted','error','uncertain'].includes(job.state)){
       await rpc('ack_print_job',{p_job:job.id,p_device:device,p_state:job.state,p_error:job.error||null});
       const key=`${job.id}:${job.state}`;
       if(job.state!=='submitted'&&!notifySeen.current.has(key)){notifySeen.current.add(key);invoke('notify',{message:'Falha de impressão. Consulte a fila do DeliveryGestor.'}).catch(()=>{});}
      }
     }
    }
   }catch(e){if(!stopped){setStatus('Sincronização pendente · nova tentativa automática');setError(e.message||String(e));}}
   finally{running=false;if(refreshAgain&&!stopped){refreshAgain=false;void refresh()}}
  }
  void refresh();const timer=setInterval(refresh,5000);
  const channel=client.channel(`operations:${storeId}`).on('postgres_changes',{event:'*',schema:'public',table:'orders',filter:`store_id=eq.${storeId}`},refresh).subscribe(state=>{if(state==='SUBSCRIBED')void refresh()});
  return()=>{stopped=true;clearInterval(timer);client.removeChannel(channel)};
 },[client,storeId,device,desktop,manager]);
 async function saveMode(source,mode,enabled){const {error}=await client.from('acceptance_settings').upsert({store_id:storeId,source,mode,enabled},{onConflict:'store_id,source'});if(error)throw error;setSettings(old=>[...old.filter(s=>s.source!==source),{source,mode,enabled}])}
 async function savePrinter(e){e.preventDefault();const form=e.currentTarget,f=new FormData(form);await act(async()=>{const {error}=await client.from('print_sectors').upsert({store_id:storeId,sector:String(f.get('sector')).trim(),printer:String(f.get('printer')).trim(),width:Number(f.get('width')),copies:Number(f.get('copies')),enabled:true},{onConflict:'store_id,sector'});if(error)throw error;form.reset()})}
 async function createOrder(e){e.preventDefault();const form=e.currentTarget,f=new FormData(form);await act(async()=>{const q=Number(f.get('quantity')),p=Number(f.get('price'));await rpc('create_operational_order',{p_store:storeId,p_request:createRequest.current,p_customer:f.get('customer'),p_address:f.get('address'),p_items:[{name:f.get('item'),quantity:q,unit_price:p,modifiers:String(f.get('modifiers')||'').split(',').map(s=>s.trim()).filter(Boolean)}],p_total:q*p,p_notes:f.get('notes'),p_payment:f.get('payment'),p_logistics:f.get('logistics')});createRequest.current=crypto.randomUUID();form.reset()})}
 async function registerPayment(e){e.preventDefault();if(!paymentOrder)return;await act(async()=>{const amount=Number(paymentAmount.replace(',','.'));if(!Number.isFinite(amount)||amount<=0)throw Error('Informe um valor válido.');await rpc('pitacco_record_payment',{p_order:paymentOrder.id,p_request:paymentRequest.current,p_amount:amount,p_method:paymentMethod,p_reference:paymentReference.trim()||null});paymentRequest.current=crypto.randomUUID();const data=await rpc('pitacco_store_payment_summary',{p_store:storeId});setPaymentSummary(data||[]);setPaymentOrder(null);setPaymentAmount('');setPaymentReference('')})}
 async function reprint(orderId){const key=orderId;if(!reprintRequests.current.has(key))reprintRequests.current.set(key,crypto.randomUUID());await rpc('reprint_order',{p_order:orderId,p_request:reprintRequests.current.get(key),p_reason:'Reimpressão solicitada pelo botão do pedido'});reprintRequests.current.delete(key)}
 const stage=o=>orderStage(o,deliveryRows.find(d=>d.order_id===o.id));
 const filtered=orders.filter(o=>matchesOrder(o,query));
 const waiting=orders.filter(o=>stage(o)==='analysis');
 const preparing=orders.filter(o=>stage(o)==='preparing');
 const ready=orders.filter(o=>stage(o)==='ready');
 const printAlerts=jobs.filter(j=>['error','uncertain'].includes(j.state));
 const visible=view==='Pedidos'||view==='Cozinha e expedição'||view==='Configurações';
 return <section hidden={!visible} aria-label={view==='Pedidos'?'Central de pedidos':'Configurações da operação'}>
 <div className="connection-bar"><span className="status-dot"/>{status}<span className="badge neutral">{desktop?'Aplicativo Windows':'Painel web'}</span></div>
 {error&&<p role="alert" className="notice error">{error}</p>}{!manager&&<div className="panel">Solicite acesso de gestor para operar pedidos e configurações.</div>}
 {manager&&desktop&&view==='Pedidos'&&<div className="operational-overview" aria-label="Resumo da operação"><article className={waiting.length?'attention':''}><span>Aguardando aceite</span><strong>{waiting.length}</strong><small>Pedidos novos</small></article><article><span>Em preparo</span><strong>{preparing.length}</strong><small>Na cozinha</small></article><article><span>Prontos</span><strong>{ready.length}</strong><small>Aguardando saída ou retirada</small></article><article className={printAlerts.length?'attention':''}><span>Impressão</span><strong>{printAlerts.length?'Atenção':'Normal'}</strong><small>{printAlerts.length?printAlerts.length+' trabalho(s) para verificar':'Nenhuma falha local detectada'}</small></article></div>}
 {manager&&['Pedidos','Cozinha e expedição'].includes(view)&&<>
 <div className="orders-toolbar"><div className="view-switch"><button className={orderFilter==='board'?'active':''} onClick={()=>setOrderFilter('board')}>Quadro de pedidos</button><button className={orderFilter==='completed'?'active':''} onClick={()=>setOrderFilter('completed')}>Concluídos</button></div><input aria-label="Buscar pedido" placeholder="Buscar nome, telefone ou código" value={query} onChange={e=>setQuery(e.target.value)}/><button onClick={()=>{const el=document.getElementById('new-order');el.open=!el.open;if(el.open)el.querySelector('input')?.focus()}}>+ Nova venda</button></div>
 <details id="new-order" className="panel order-create"><summary>Registrar venda no balcão</summary><p>Registre o atendimento da loja. O pagamento é apenas informado; nenhuma cobrança online é realizada.</p><form onSubmit={createOrder}><label className="field">Cliente<input name="customer" placeholder="Cliente" required maxLength={150}/></label><label className="field">Endereço / retirada<input name="address" placeholder="Endereço / retirada" required maxLength={500}/></label><label className="field">Produto<input name="item" placeholder="Produto" required maxLength={200}/></label><label className="field">Quantidade<input name="quantity" aria-label="Quantidade" type="number" min="1" max="100" defaultValue="1" required/></label><label className="field">Preço unitário<input name="price" placeholder="Preço unitário" type="number" step="0.01" min="0.01" required/></label><label className="field">Complementos separados por vírgula<input name="modifiers" placeholder="Complementos separados por vírgula"/></label><label className="field">Observações<input name="notes" placeholder="Observações"/></label><label className="field">Forma de pagamento<select name="payment"><option value="dinheiro">Dinheiro</option><option value="pix">Pix (registrar, sem cobrança)</option><option value="cartao">Cartão (registrar, sem cobrança)</option></select></label><label className="field">Entrega ou retirada<select name="logistics"><option value="loja">Entrega própria</option><option value="retirada">Retirada</option></select></label><button disabled={busy}>Criar pedido</button></form></details>

 {!sectors.some(s=>s.enabled)&&<div className="notice">Configure um setor de impressão antes de aceitar pedidos. <button className="linkbutton" onClick={()=>onNavigate('Configurações')}>Configurar impressora</button></div>}
 <div className={'kanban '+(orderFilter==='completed'?'history-board':'')}>{(orderFilter==='completed'?[['completed','Concluídos']]:view==='Cozinha e expedição'?columns.filter(([key])=>['preparing','ready'].includes(key)):columns).map(([id,label])=>{const items=filtered.filter(o=>stage(o)===id);return <section className={'kanban-column '+id} key={id}><div className="column-header"><div><h3>{label}</h3><span>{items.length}</span></div><small>{currency(items.reduce((total,o)=>total+Number(o.gross),0))}</small></div><div className="column-body">{items.map(o=><article className="order-card" key={o.id}><div className="card-heading"><b>#{o.id.slice(0,8)}</b><span className="order-time">{new Date(o.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span>{o.status==='accepted'&&<button type="button" className="order-print-button" title="Reimprimir comanda agora" aria-label={"Reimprimir comanda do pedido "+o.id.slice(0,8)} disabled={busy} onClick={()=>act(()=>reprint(o.id))}><Printer size={18} aria-hidden="true"/></button>}</div><h3>{o.receipt?.customer||'Cliente'}</h3><p>{SOURCES.find(([source])=>source===o.source)?.[1]||o.source} · {o.receipt?.logistics==='retirada'?'Retirada':'Entrega'}</p><div className="order-items">{(o.receipt?.items||[]).map((item,i)=><div key={i}>{item.quantity} × {item.name}</div>)}</div><div className="card-payment"><strong>{currency(o.gross)}</strong><span className={o.source==='proprio'&&paymentSummary.some(p=>p.order_id===o.id&&Number(p.remaining)<=0.005)?'payment-paid':''}>{o.receipt?.payment||'Pagamento não informado'} · {(()=>{const p=paymentSummary.find(p=>p.order_id===o.id);return p&&Number(p.remaining)<=0.005?'Pedido pago':p&&Number(p.paid)>0?'Parcial: '+currency(p.paid):'A receber'})()}</span></div>{o.source==='proprio'&&!(paymentSummary.some(p=>p.order_id===o.id&&Number(p.remaining)<=0.005))&&<button className="secondary" disabled={busy} onClick={()=>{const p=paymentSummary.find(p=>p.order_id===o.id);setPaymentOrder(o);setPaymentAmount(String(Number(p?.remaining??o.gross).toFixed(2)));setPaymentReference('')}}>Registrar recebimento</button>}<div className="logistics-state"><small>Preparo: {o.preparation_status==='ready'?'pronto':o.preparation_status==='completed'?'concluído':o.status==='pending'?'aguardando aceite':'em preparo'}</small><small>{o.receipt?.logistics==='retirada'?'Retirada no balcão':deliveryLabel(deliveryRows.find(d=>d.order_id===o.id))}</small>{courierRows.find(c=>c.id===deliveryRows.find(d=>d.order_id===o.id)?.courier_id)?.name}</div><button className="linkbutton" onClick={()=>{setDispatchOnly(false);setDetail(o)}}>Detalhes e entrega</button><div className="order-actions">{id==='analysis'&&o.source==='proprio'&&<button disabled={busy} onClick={()=>act(()=>rpc('accept_order',{p_order:o.id}))}>Aceitar pedido</button>}{id==='preparing'&&o.source==='proprio'&&<button disabled={busy} onClick={()=>act(()=>rpc('set_order_preparation',{p_order:o.id,p_status:'ready'}))}>Marcar como pronto</button>}{id==='ready'&&(o.receipt?.logistics==='retirada'?<button disabled={busy} onClick={()=>act(()=>rpc('set_order_preparation',{p_order:o.id,p_status:'completed'}))}>Confirmar retirada</button>:<button className="dispatch-highlight" onClick={()=>{setDispatchOnly(true);setDetail(o)}}>Despachar entrega</button>)}</div></article>)}{!items.length&&<div className="column-empty">Nenhum pedido nesta etapa</div>}</div></section>})}</div><p className="hint">Exibindo até 100 pedidos operacionais recentes. A etapa Em entrega acompanha a retirada registrada pelo entregador.</p>

 </>}
 {manager&&view==='Configurações'&&<>
 <div className="tabs" aria-label="Seções de configuração">{['Impressoras','Aceite de pedidos','Alertas e aplicativo'].map(name=><button key={name} className={settingsTab===name?'active':''} aria-pressed={settingsTab===name} onClick={()=>setSettingsTab(name)}>{name}</button>)}</div>
 {settingsTab==='Impressoras'&&<>
 <div className="panel"><h3>Computador de impressão</h3><p>Os pedidos aceitos são impressos pelo computador vinculado à loja.</p>{desktop?<><button disabled={busy||!device} onClick={()=>act(()=>rpc('bind_print_device',{p_store:storeId,p_device:device}))}>Vincular este computador</button><details className="technical"><summary>Identificação do dispositivo</summary><code>{device||'Carregando…'}</code></details></>:<p>Abra o aplicativo Windows para vincular uma impressora.</p>}</div>
    <div className="panel"><h3>Impressoras por setor</h3><p>Instale a impressora no Windows. USB, rede e Bluetooth usam a fila do driver; o modelo deve aceitar ESC/POS RAW. Configure antes de aceitar pedidos.</p><form onSubmit={savePrinter}><label className="field">Setor (ex.: cozinha)<input name="sector" placeholder="Setor (ex.: cozinha)" maxLength={80} required/></label><label className="field">Nome exato da impressora no Windows<input name="printer" list="windows-printers" placeholder="Nome exato da impressora no Windows" maxLength={200} required/></label><datalist id="windows-printers">{printers.map(p=><option key={p} value={p}/>)}</datalist><label className="field">Largura do papel<select name="width" aria-label="Largura"><option value="80">80 mm</option><option value="58">58 mm</option></select></label><label className="field">Vias<input name="copies" aria-label="Vias" type="number" min="1" max="5" defaultValue="1" required/></label><button disabled={busy}>Salvar setor</button></form>{sectors.map(s=><div className="line" key={s.sector}><b>{s.sector}</b><span>{s.printer} · {s.width} mm · {s.copies} via(s)</span><button disabled={busy} onClick={()=>act(async()=>{const {error}=await client.from('print_sectors').update({enabled:!s.enabled}).eq('store_id',storeId).eq('sector',s.sector);if(error)throw error})}>{s.enabled?'Desativar':'Ativar'}</button></div>)}</div>
   {desktop&&<div className="panel"><h3>Fila persistente deste computador</h3><p>Ao sair da conta ou trocar de loja, a fila anterior fica pausada até selecionar a loja novamente. Em resultado incerto, confira o papel e o spooler antes de solicitar reimpressão com motivo. Não há repetição automática de trabalhos incertos.</p>{jobs.map(j=><div className="delivery-item" key={j.id}><b>{j.id.slice(0,8)} · {j.state}</b><p>{j.printer}</p>{j.error&&<p role="alert">{j.error}</p>}{j.state==='error'&&<button disabled={busy} onClick={()=>act(()=>invoke('retry_job',{id:j.id}))}>Tentar novamente (falha anterior ao envio)</button>}</div>)}{!jobs.length&&<p>Sem trabalhos locais para esta loja.</p>}</div>}
 </>}
 {settingsTab==='Aceite de pedidos'&&<>   <div className="panel"><h3>Aceite por origem</h3><p>Integrações de marketplaces ainda dependem de credenciais e homologação. Selecionar automático não confirma pedidos sem resposta oficial.</p>{SOURCES.map(([source,label])=>{const s=settings.find(s=>s.source===source)||{mode:'manual',enabled:false};return <div className="line" key={source}><b>{label}</b><select aria-label={`Modo ${label}`} disabled={busy} value={s.mode} onChange={e=>act(()=>saveMode(source,e.target.value,s.enabled))}><option value="manual">Manual</option><option value="automatic">Automático</option></select><label><input type="checkbox" checked={s.enabled} disabled={busy} onChange={e=>act(()=>saveMode(source,s.mode,e.target.checked))}/> Habilitado</label></div>})}</div>
</>}
 {settingsTab==='Alertas e aplicativo'&&<div className="panel"><h3>Preferências do aplicativo</h3>{desktop?<><label className="toggle"><input type="checkbox" checked={autoStart} onChange={e=>{const value=e.target.checked;act(async()=>{await invoke('set_autostart',{enabled:value});setAutoStart(value)})}}/>Iniciar com o Windows</label><div className="quick-actions"><button onClick={()=>act(()=>invoke('notify',{message:'Teste de notificação do Pitacco.'}))}>Testar notificação e som</button><button className="secondary" disabled={busy} onClick={()=>act(async()=>{const result=await invoke('check_update');setStatus(String(result||'Verificação concluída.'))})}>Verificar atualização assinada</button></div><p>Ao fechar a janela, o Pitacco permanece na bandeja do Windows.</p></>:<label className="toggle"><input type="checkbox" checked={sound} onChange={e=>setSound(e.target.checked)}/>Ativar som nesta página</label>}</div>}
 </>}
 {paymentOrder&&<div className="payment-modal-backdrop" role="presentation"><section className="panel payment-modal" role="dialog" aria-modal="true" aria-label="Registrar recebimento"><h3>Registrar recebimento</h3><p>Pedido #{paymentOrder.id.slice(0,8)} · {currency(paymentOrder.gross)}</p><p className="hint">Registre somente dinheiro ou pagamento que você já conferiu. Selecionar Pix ou cartão aqui não realiza cobrança nem consulta a operadora.</p><form onSubmit={registerPayment}><label className="field">Valor recebido<input type="number" min="0.01" step="0.01" required value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)}/></label><label className="field">Forma de pagamento<select value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)}><option value="dinheiro">Dinheiro recebido</option><option value="pix">Pix confirmado manualmente</option><option value="cartao_debito">Débito confirmado</option><option value="cartao_credito">Crédito confirmado</option><option value="outro">Outro recebimento confirmado</option></select></label><label className="field">Referência / observação<input maxLength={120} value={paymentReference} onChange={e=>setPaymentReference(e.target.value)} placeholder="Opcional"/></label><div className="quick-actions"><button disabled={busy}>Confirmar recebimento</button><button className="secondary" type="button" onClick={()=>setPaymentOrder(null)}>Cancelar</button></div></form></section></div>}
 {detail&&<DeliveryDialog key={detail.id} client={client} storeId={storeId} order={detail} dispatchOnly={dispatchOnly} onClose={()=>setDetail(null)}/>}
 </section>
}
