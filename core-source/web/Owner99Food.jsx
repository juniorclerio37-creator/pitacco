
import React,{useEffect,useRef,useState} from 'react';

const stages=[
 [
  "99food_acesso",
  "Acesso ao sandbox",
  "Cadastre o aplicativo Pitacco e obtenha acesso à loja de testes no portal oficial."
 ],
 [
  "99food_vinculo",
  "Vínculo pelo lojista",
  "Vincule a conta 99Food na loja correta e confirme que outra loja Pitacco não consegue usar esse vínculo."
 ],
 [
  "99food_recebimento",
  "Recebimento de pedidos",
  "Envie um pedido de teste e confira se aparece na loja vinculada. O reenvio do evento deve manter um único pedido."
 ],
 [
  "99food_andamento",
  "Aceite, preparo e cancelamento",
  "Confira o aceite, a preparação, a conclusão e o cancelamento conforme os estados recebidos ou confirmados pela 99Food."
 ],
 [
  "99food_entrega_propria",
  "Entrega da loja",
  "Confira se a loja pode alocar seu motoboy e atualizar a entrega pelo fluxo normal."
 ],
 [
  "99food_entrega_plataforma",
  "Entrega pela 99Food",
  "Confira se o pedido segue o fluxo normal com a logística da plataforma, sem opção de alocar motoboy da loja."
 ]
];
const outcomes={pending:'Pendente',failed:'Com falha',approved:'Aprovado em teste'};
const labels=Object.fromEntries(stages.map(([key,name])=>[key,name]));
const dates=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
export default function Owner99Food({client,stores}){
 const [store,setStore]=useState('');
 return <section className="panel" aria-label="Homologação 99Food">
  <h3>Homologação 99Food</h3>
  <p>Registre os resultados dos testes por loja. A aprovação aqui documenta a conferência no sandbox.</p>
  <p><a href="https://developer-food.99app.com/pt-BR/home" target="_blank" rel="noopener noreferrer">Abrir Portal de Desenvolvedores da 99Food</a></p>
  <label htmlFor="food99-store">Loja Pitacco para o teste</label>
  <select id="food99-store" value={store} onChange={event=>setStore(event.target.value)}>
   <option value="">Selecione o estabelecimento</option>
   {stores.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
  </select>
  {store&&<StoreTests key={store} client={client} store={store}/>}
 </section>;
}

function StoreTests({client,store}){
 const [data,setData]=useState(null),[stage,setStage]=useState(stages[0][0]);
 const [attempt,retry]=useState(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [loadError,setLoadError]=useState(''),[saveError,setSaveError]=useState(''),[saved,setSaved]=useState(false);
 const request=useRef(null),saving=useRef(false);
 useEffect(()=>{
  const controller=new AbortController();
  let live=true;
  setLoading(true);setLoadError('');
  (async()=>{
   try{
    const {data,error}=await client.rpc('pitacco_owner_99food_homologation',{p_store:store}).abortSignal(controller.signal);
    if(error||!Array.isArray(data?.history))throw error||Error();
    if(live)setData(data);
   }catch{if(live)setLoadError('Não foi possível carregar os testes da loja.');}
   finally{if(live)setLoading(false);}
  })();
  return()=>{live=false;controller.abort();};
 },[client,store,attempt]);

 async function save(event){
  event.preventDefault();
  if(saving.current)return;
  const form=event.currentTarget;
  const fields=new FormData(form);
  const params={p_store:store,p_scope:stage,p_outcome:fields.get('outcome'),p_notes:String(fields.get('notes')).trim()};
  if(params.p_notes.length<3){setSaveError('Descreva o resultado em pelo menos três caracteres.');return;}
  saving.current=true;setBusy(true);setSaveError('');setSaved(false);
  try{
   const signature=JSON.stringify(params);
   if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()};
   const {error}=await client.rpc('pitacco_admin_record_homologation',{...params,p_request:request.current.id});
   if(error)throw error;
   request.current=null;
   form.reset();setSaved(true);retry(value=>value+1);
  }catch{setSaveError('Não foi possível registrar o teste da 99Food. Tente novamente.');}
  finally{saving.current=false;setBusy(false);}
 }

 return <>
  {loading&&<p role="status">Consultando testes…</p>}
  {loadError&&<p role="alert">{loadError} <button type="button" className="secondary" onClick={()=>retry(value=>value+1)}>Tentar novamente</button></p>}
  {data&&<>
   <div className="owner-dashboard-table" tabIndex={0}><table aria-label="Etapas da 99Food">
    <thead><tr><th scope="col">Etapa</th><th scope="col">Último resultado</th></tr></thead>
    <tbody>{stages.map(([key,name])=><tr key={key}>
     <th scope="row">{name}</th><td>{outcomes[data.stages[key]]||'Sem registro'}</td>
    </tr>)}</tbody>
   </table></div>
   <form aria-label="Registrar teste da 99Food" onSubmit={save}>
    <label htmlFor="food99-stage">Etapa</label>
    <select id="food99-stage" value={stage} disabled={busy} onChange={event=>setStage(event.target.value)}>
     {stages.map(([key,name])=><option key={key} value={key}>{name}</option>)}
    </select>
    <p>{stages.find(([key])=>key===stage)[2]}</p>
    <label htmlFor="food99-outcome">Resultado do teste</label>
    <select id="food99-outcome" name="outcome" disabled={busy}>
     {Object.entries(outcomes).map(([key,label])=><option key={key} value={key}>{label}</option>)}
    </select>
    <label htmlFor="food99-notes">Evidência do teste</label>
    <textarea id="food99-notes" name="notes" required minLength={3} maxLength={1200} rows={3} disabled={busy}
     aria-describedby="food99-notes-guide"/>
    <p id="food99-notes-guide">Informe a referência do teste e o que aconteceu. Guarde as credenciais no ambiente seguro da integração.</p>
    <button disabled={busy||loading}>{busy?'Salvando…':'Registrar teste'}</button>
   </form>
   {saveError&&<p role="alert">{saveError}</p>}
   {saved&&<p role="status">Teste da 99Food registrado.</p>}
   <h4>Histórico da loja</h4>
   {data.history.length?<ul>{data.history.map(item=><li key={item.id}><strong>{labels[item.scope]} · {outcomes[item.outcome]}</strong>
    <div>{dates.format(new Date(item.recorded_at))}</div><p>{item.notes}</p></li>)}</ul>:<p>Nenhum teste registrado para esta loja.</p>}
  </>}
 </>;
}
