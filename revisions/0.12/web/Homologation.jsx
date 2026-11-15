import React, {useEffect,useRef,useState} from 'react';

const checks={
 asaas:['Assinatura Asaas','Use uma cobrança de sandbox. Confira o valor, o vínculo da assinatura e se a confirmação chegou ao Pitacco.'],
 marketplaces:['Marketplaces','Use a conta oficial de homologação de iFood, 99Food ou Keeta. Registre a plataforma e o resultado do recebimento e do aceite.'],
 repasse:['Conciliação de repasses','Importe em Relatórios um CSV de teste com pedido_externo e repasse_liquido. Confira valores iguais, divergências e pedidos ausentes.'],
 pedidos:['Cardápio e pedidos','Abra o cardápio da loja de teste. Confira carrinho, checkout, agendamento e acompanhamento.'],
 entregas:['Entregas e rastreio','Use uma entrega de teste. Confira a saída da loja, o GPS do entregador e a atualização do link do cliente.'],
 whatsapp:['WhatsApp','Use a conta autorizada da Meta e um número de teste para conferir a entrega das mensagens.'],
 windows:['Impressão Windows','Registre o resultado físico em 58 mm e 80 mm, incluindo teste, impressão após aceite e reimpressão.'],
 publicacao:['Publicação web e Supabase','Confira a versão de homologação, a migração, a configuração do Cloudflare e o isolamento entre lojas.']
};
const outcomes={approved:'Aprovado em teste',failed:'Com falha',pending:'Pendente'};
const asaases={
 sandbox_key_missing:'A chave de sandbox ainda precisa ser configurada no Supabase.',
 not_found:'A cobrança não foi encontrada na conta de sandbox configurada.',
 provider_unavailable:'O Asaas Sandbox está indisponível ou a chave precisa ser conferida.'
};
const date=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});

export default function Homologation({client,stores}){
 const [store,setStore]=useState(''),[scope,setScope]=useState('asaas'),[status,setStatus]=useState('pending');
 const [history,setHistory]=useState(null),[historyError,setHistoryError]=useState('');
 const [probe,setProbe]=useState(null),[asaas,setAsaas]=useState(null),[busy,setBusy]=useState('');
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const running=useRef(false),saveAttempt=useRef(null),historyRequest=useRef(0);

 async function loadHistory(){
  const request=++historyRequest.current;
  setHistoryError('');
  try{
   const {data,error}=await client.rpc('pitacco_admin_homologation_results');
   if(error)throw error;
   if(request===historyRequest.current)setHistory(data);
  }catch(failure){if(request===historyRequest.current)setHistoryError(failure.message||'Não foi possível consultar o histórico.');}
 }
 useEffect(()=>{loadHistory();},[client]);
 async function run(action,operation){
  if(running.current)return;
  running.current=true;
  setBusy(action);
  setError('');
  setNotice('');
  try{await operation();}
  catch(failure){setError(failure.message||'Não foi possível concluir esta ação.');}
  finally{running.current=false;setBusy('');}
 }
 function verifyStore(){
  setProbe(null);
  run('probe',async()=>{
   const {data,error}=await client.rpc('pitacco_admin_homologation_probe',{p_store:store});
   if(error)throw error;
   setProbe(data);
  });
 }
 function verifyAsaas(event){
  event.preventDefault();
  const payment=String(new FormData(event.currentTarget).get('payment_id')).trim();
  setAsaas(null);
  run('asaas',async()=>{
   const {data,error}=await client.functions.invoke('asaas-homologation',{body:{store_id:store,payment_id:payment}});
   if(error){
    const detail=error.context instanceof Response?await error.context.clone().json().catch(()=>null):null;
    throw Error(detail?.error||'A verificação de sandbox está indisponível. Confira se a função foi publicada.');
   }
   setAsaas(data);
  });
 }
 function saveResult(event){
  event.preventDefault();
  const form=event.currentTarget;
  const notes=String(new FormData(form).get('notes')).trim();
  run('save',async()=>{
   const payload={p_store:store||null,p_scope:scope,p_outcome:status,p_notes:notes};
   const signature=JSON.stringify(payload);
   if(saveAttempt.current?.signature!==signature)saveAttempt.current={signature,id:crypto.randomUUID()};
   const {error}=await client.rpc('pitacco_admin_record_homologation',{...payload,p_request:saveAttempt.current.id});
   if(error)throw error;
   saveAttempt.current=null;
   form.reset();
   setNotice('Resultado registrado no histórico.');
   await loadHistory();
  });
 }

 return <section aria-label="Homologação do Pitacco">
  <div className="panel">
   <h3>Estabelecimento de teste</h3>
   <label>Loja <select value={store} disabled={!!busy} onChange={event=>{
    setStore(event.target.value);setProbe(null);setAsaas(null);setError('');setNotice('');
   }}>
    <option value="">Sem loja vinculada ao teste</option>
    {stores.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
   </select></label>
   <div className="dispatch-actions">
    <button type="button" className="secondary" disabled={!store||!!busy} onClick={verifyStore}>
     {busy==='probe'?'Verificando…':'Verificar configuração da loja'}
    </button>
   </div>
   {probe&&<ul aria-label="Configuração da loja">
    <li>{probe.menu_has_checkout?'O cardápio tem atendimento e pagamento configurados.':'Cardápio e checkout precisam de configuração.'}
     {probe.menu_slug&&<> <a href={'/cardapio/?loja='+encodeURIComponent(probe.menu_slug)} target="_blank" rel="noopener noreferrer">Abrir cardápio</a></>}
    </li>
    <li>{probe.has_active_products?'A loja possui produtos ativos.':'A loja ainda precisa de produtos ativos.'}</li>
    <li>{probe.sandbox_store_linked?'Loja vinculada a uma assinatura no Asaas Sandbox.':'Vínculo com assinatura de sandbox pendente.'}</li>
   </ul>}
  </div>

  <div className="panel">
   <h3>Verificar cobrança Asaas Sandbox</h3>
   <p>Use o identificador da cobrança de teste. A consulta verifica o Asaas e o registro no Pitacco.</p>
   <form onSubmit={verifyAsaas}>
    <label>ID da cobrança de teste <input name="payment_id" required pattern="pay_[A-Za-z0-9_\-]+" maxLength={104} placeholder="pay_…" disabled={!!busy}/></label>
    <button disabled={!store||!!busy}>{busy==='asaas'?'Consultando…':'Consultar cobrança de teste'}</button>
   </form>
   {asaas&&<div aria-label="Resultado da consulta Asaas">
    {asaas.outcome==='checked'?<ul>
     <li>{asaas.confirmed?'Pagamento confirmado pelo Asaas.':'Pagamento ainda sem confirmação no Asaas.'}</li>
     <li>{asaas.plan_amount?'Valor de R$ 59,90 conferido.':'Valor diferente de R$ 59,90.'}</li>
     <li>{asaas.linked?'Assinatura vinculada à loja selecionada.':'Vínculo da cobrança com a loja pendente.'}</li>
     <li>{asaas.sandbox_enabled?'Ambiente de sandbox habilitado para receber confirmações.':'Recebimento de confirmações de sandbox pendente no Pitacco.'}</li>
     <li>{asaas.recorded?'Confirmação registrada pelo Pitacco.':'Registro da confirmação no Pitacco pendente.'}</li>
    </ul>:<p role="status">{asaases[asaas.outcome]||'Consulta indisponível.'}</p>}
   </div>}
  </div>

  <div className="panel">
   <h3>Registrar resultado</h3>
   <form onSubmit={saveResult}>
    <label>Teste <select value={scope} onChange={event=>setScope(event.target.value)} disabled={!!busy}>
     {Object.entries(checks).map(([key,[label]])=><option key={key} value={key}>{label}</option>)}
    </select></label>
    <label>Resultado <select value={status} onChange={event=>setStatus(event.target.value)} disabled={!!busy}>
     {Object.entries(outcomes).map(([key,label])=><option key={key} value={key}>{label}</option>)}
    </select></label>
    <label>Observação <textarea name="notes" required minLength={3} maxLength={1200} rows={3} disabled={!!busy}/></label>
    <p>{checks[scope][1]} Use a observação para registrar o cenário e o resultado. Chaves e tokens ficam na configuração do provedor.</p>
    <button disabled={!!busy}>{busy==='save'?'Salvando…':'Salvar resultado'}</button>
   </form>
  </div>
  {error&&<p role="alert">{error}</p>}
  {notice&&<p role="status">{notice}</p>}

  <div className="panel">
   <h3>Histórico de homologação</h3>
   <button type="button" className="secondary" onClick={loadHistory} disabled={busy==='save'}>Atualizar histórico</button>
   {historyError?<p role="alert">{historyError}</p>:!history?<p role="status">Carregando histórico…</p>:!history.length?<p>Nenhum resultado registrado.</p>:
    <ul>{history.map(item=><li key={item.id}>
     <strong>{checks[item.scope][0]} · {outcomes[item.outcome]}</strong>
     <div>{item.store_name||'Plataforma'} · {date.format(new Date(item.recorded_at))}</div>
     <p>{item.notes}</p>
    </li>)}</ul>}
  </div>
 </section>;
}
