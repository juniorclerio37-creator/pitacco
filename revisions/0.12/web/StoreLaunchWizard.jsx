import React,{useEffect,useState} from 'react';
import './store-launch-wizard.css';

const essentials=[
 {title:'Dados da loja',codes:['identity','address'],tab:'Minha Loja',
  detail:'Cadastre nome, telefone e endereço completo. O ponto de partida das entregas será o endereço da loja.'},
 {title:'Produtos do cardápio',codes:['products'],tab:'Produtos',
  detail:'Adicione ao menos um produto ativo, com nome e preço, e revise complementos e categorias.'},
 {title:'Identidade visual',codes:[],tab:'Aparência do cardápio',optional:true,
  detail:'Escolha tema, cores, logotipo e banners. Salve o rascunho e publique a aparência separadamente.'},
 {title:'Pagamentos e checkout',codes:['payments','checkout_configuration'],tab:'Pagamentos da loja',
  detail:'Defina formas aceitas, instruções de Pix manual e confira o checkout. Nenhuma cobrança é realizada nesta etapa.'},
 {title:'Entregas e retirada',codes:['fulfillment','delivery_rules'],tab:'Área de entrega',
  detail:'Escolha retirada ou entrega e revise endereço de saída, raio e valor do frete. Tarifas por trajeto dependem de homologação.'},
 {title:'Publicar o cardápio',codes:['catalog_link','catalog_live'],tab:'Pagamentos da loja',
  detail:'Revise o link da loja e publique o cardápio conscientemente. A publicação não será ativada pelo assistente sem sua confirmação.'},
 {title:'Testes da operação',codes:['print_on_paper','notifications_on_device','order_to_delivery'],tab:'Configurações',manual:true,
  detail:'Teste no equipamento real: aceite, impressão no papel, alerta do aplicativo e chegada/entrega. Esta etapa exige confirmação humana.'}
];
const diagnostics=[
 ['identity','Nome e identificação'],
 ['address','Endereço de saída'],
 ['products','Produtos disponíveis'],
 ['payments','Pagamento configurado'],
 ['fulfillment','Entrega ou retirada'],
 ['delivery_rules','Regras de entrega'],
 ['catalog_link','Link do cardápio'],
 ['catalog_live','Cardápio acessível pela API'],
 ['checkout_configuration','Configuração do checkout'],
 ['printer_configuration','Vinculação da impressora'],
 ['print_on_paper','Impressão física no papel'],
 ['notifications_on_device','Notificações no dispositivo'],
 ['order_to_delivery','Pedido até entrega final'],
 ['marketplace_integrations','Integrações de marketplaces']
];
const statusNames={ok:'Verificado no sistema',action:'Precisa de configuração',manual:'Teste presencial pendente',optional:'Opcional / requer homologação'};
const localTime=value=>value?new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—';
function detailReport(report){
 const list=report?.checks||{};
 return diagnostics.map(([code,title])=>({code,title,status:list[code]||'manual'}));
}

export function OnboardingNudge({client,storeId,onNavigate}){
 const [ready,setReady]=useState(null),[hidden,setHidden]=useState(false);
 useEffect(()=>{
  let live=true;setHidden(false);setReady(null);
  if(!storeId)return;
  client.rpc('pitacco_store_readiness',{p_store:storeId}).then(({data,error})=>{
   if(live&&!error)setReady(Boolean(data?.ready));
  }).catch(()=>{});
  return()=>{live=false};
 },[client,storeId]);
 if(ready!==false||hidden)return null;
 return <section className="launch-nudge" aria-label="Preparar o Pitacco para operar">
  <div><strong>Prepare seu estabelecimento para começar</strong>
   <p>O assistente reúne os primeiros passos e verifica configurações sem realizar pedidos ou cobranças.</p></div>
  <div className="launch-nudge-buttons">
   <button type="button" onClick={()=>onNavigate('Primeiros passos')}>Iniciar configuração</button>
   <button type="button" className="secondary" onClick={()=>setHidden(true)}>Mais tarde</button>
  </div>
 </section>;
}

export default function StoreLaunchWizard({client,store,manager,onNavigate,onStoreSaved}){
 const [step,setStep]=useState(0),[report,setReport]=useState(null),[history,setHistory]=useState([]);
 const [identity,setIdentity]=useState({name:store.name||'',phone:store.phone||'',address:store.address||'',
  address_number:store.address_number||'',neighborhood:store.neighborhood||'',city:store.city||'',
  state:store.state||'',postal_code:store.postal_code||''});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [historyOpen,setHistoryOpen]=useState(false),[attempt,setAttempt]=useState(0);
 const summary=detailReport(report);
 const completed=essentials.filter(x=>!x.optional&&!x.manual&&x.codes.every(code=>report?.checks?.[code]==='ok')).length;
 const required=essentials.filter(x=>!x.optional&&!x.manual).length;
 const current=essentials[step];

 useEffect(()=>{
  let live=true;setError('');setNotice('');setReport(null);
  client.rpc('pitacco_store_launch_diagnostic',{p_store:store.id}).then(({data,error})=>{
   if(error)throw error;
   if(live)setReport(data);
  }).catch(err=>{if(live)setError(err.message||'Não foi possível conferir as configurações.')});
  client.rpc('pitacco_store_preflight_history',{p_store:store.id}).then(({data,error})=>{
   if(live&&!error&&Array.isArray(data))setHistory(data);
  }).catch(()=>{});
  return()=>{live=false};
 },[client,store.id,attempt]);
 useEffect(()=>setIdentity({name:store.name||'',phone:store.phone||'',address:store.address||'',
  address_number:store.address_number||'',neighborhood:store.neighborhood||'',city:store.city||'',
  state:store.state||'',postal_code:store.postal_code||''}),[store.id]);

 async function saveBasics(event){
  event.preventDefault();
  if(!manager)return;
  setBusy(true);setError('');setNotice('');
  try{
   if(identity.name.trim().length<3||identity.address.trim().length<3||identity.city.trim().length<2||identity.state.trim().length<2)
    throw Error('Informe o nome, a rua, a cidade e o estado para continuar.');
   const fields=Object.fromEntries(Object.entries(identity).map(([key,value])=>[key,String(value).trim()]));
   const {data,error}=await client.from('stores').update(fields).eq('id',store.id).select('id').single();
   if(error)throw error;
   if(data?.id!==store.id)throw Error('A loja retornada é diferente da selecionada.');
   setNotice('Dados da loja salvos. Continue pelas próximas etapas.');
   await onStoreSaved?.();
   setAttempt(value=>value+1);
  }catch(err){setError(err.message||'Não foi possível salvar os dados.')}
  finally{setBusy(false)}
 }
 async function runPreflight(){
  setBusy(true);setError('');setNotice('');
  try{
   const {data,error}=await client.rpc('pitacco_store_run_preflight',{p_store:store.id});
   if(error)throw error;
   if(!data?.run_id)throw Error('A verificação não foi registrada pelo servidor.');
   setReport(data);setAttempt(v=>v+1);
   setNotice('Verificação registrada. Nenhum pedido, pagamento, impressão ou entrega foi disparado.');
  }catch(err){setError(err.message||'Não foi possível executar a verificação.');}
  finally{setBusy(false)}
 }
 return <section className="launch-wizard" aria-label="Assistente de configuração inicial">
  <div className="launch-heading">
   <div><span className="eyebrow">PRIMEIROS PASSOS · {store.name}</span>
    <h3>Prepare sua loja para operar</h3>
    <p>Organize as configurações em sequência, sem recriar nada. O Pitacco verifica o que já foi configurado.</p></div>
   <div className="launch-progress">
    <strong>{completed} de {required} etapas essenciais</strong>
    <progress max={required} value={completed}>{completed}/{required}</progress>
    <small>{report?.configured?'Configuração básica validada; testes reais pendentes':'Ainda há configurações pendentes'}</small>
   </div>
  </div>
  {error&&<p role="alert" className="notice error">{error}</p>}
  {notice&&<p role="status" className="notice">{notice}</p>}
  <div className="launch-grid">
   <nav className="launch-steps" aria-label="Etapas de preparação da loja">
    {essentials.map((item,index)=>{
     const ok=!item.optional&&!item.manual&&item.codes.every(code=>report?.checks?.[code]==='ok');
     return <button key={item.title} type="button" className={index===step?'launch-step active':'launch-step'}
      aria-current={index===step?'step':undefined} onClick={()=>setStep(index)}>
      <span className="launch-step-number">{ok?'✓':index+1}</span>
      <span><strong>{item.title}</strong><small>{ok?'Concluída':item.manual?'Verificação presencial':item.optional?'Personalização recomendada':'Revisar'}</small></span>
     </button>;
    })}
   </nav>
   <div className="launch-content">
    <section className="launch-card" aria-label="Etapa atual">
     <span className="eyebrow">ETAPA {step+1} DE {essentials.length}</span>
     <h4>{current.title}</h4>
     <p>{current.detail}</p>
     {step===0&&<form className="launch-identity" onSubmit={saveBasics}>
      {[
       ['name','Nome da loja'],['phone','Telefone'],
       ['address','Rua / avenida'],['address_number','Número'],
       ['neighborhood','Bairro'],['city','Cidade'],['state','Estado'],['postal_code','CEP']
      ].map(([key,label])=><label key={key}>{label}<input value={identity[key]||''} disabled={busy||!manager}
       required={['name','address','city','state'].includes(key)} maxLength={180}
       onChange={event=>setIdentity(old=>({...old,[key]:event.target.value}))}/></label>)}
      <button type="submit" disabled={busy||!manager}>{busy?'Salvando…':'Salvar dados básicos'}</button>
     </form>}
     {step===6&&<div className="launch-manual">
      <h5>Testes reais necessários</h5>
      <ol>
       <li>Registrar um pedido controlado em ambiente de homologação e acompanhar o aceite até a conclusão</li>
       <li>Conferir a nota <strong>impressa no papel</strong> pelo aplicativo Windows</li>
       <li>Verificar som e notificações com o aplicativo entregador aberto e fechado</li>
       <li>Testar despacho, mapa, chegada na entrega e finalização de rota</li>
       <li>Validar cada integração com iFood, 99Food ou Keeta quando a homologação oficial estiver disponível</li>
      </ol>
      <p>O diagnóstico automático não confirma esses testes nem cria pedidos fictícios no ambiente de produção.</p>
     </div>}
     <div className="launch-actions">
      <button type="button" className="secondary" disabled={step===0} onClick={()=>setStep(v=>Math.max(0,v-1))}>Voltar</button>
      <button type="button" onClick={()=>onNavigate(current.tab)}>Abrir {current.tab}</button>
      {step<essentials.length-1&&<button type="button" className="secondary" onClick={()=>setStep(v=>v+1)}>Próxima etapa</button>}
     </div>
    </section>
    <section className="launch-card" aria-label="Diagnóstico de prontidão">
     <div className="launch-section-heading">
      <div><h4>Verificação automática</h4><p>Apenas leitura das configurações e consulta ao cardápio público.</p></div>
      <button type="button" disabled={busy||!manager} onClick={runPreflight}>Executar verificação</button>
     </div>
     {!report&&<p role="status">Conferindo a loja…</p>}
     {report&&<>
      <div className="launch-result-head"><strong>{report.configured?'Configurações básicas aprovadas':'Configurações a revisar'}</strong>
       <small>Última leitura: {localTime(report.checked_at)}</small></div>
      <div className="launch-checks">
       {summary.map(check=><div key={check.code} className={'launch-check '+check.status}>
        <span>{check.status==='ok'?'✓':check.status==='action'?'!':'·'}</span>
        <span>{check.title}<small>{statusNames[check.status]||'Verificação pendente'}</small></span>
       </div>)}
      </div>
      <p className="launch-qualifier">A aprovação da configuração não é uma homologação operacional: impressão, notificações, marketplace e fluxo completo dependem de testes com equipamentos e contas reais.</p>
      {report.catalog_url&&<a className="launch-link" href={report.catalog_url} target="_blank" rel="noopener noreferrer">Abrir cardápio público da loja</a>}
     </>}
     <div className="launch-history-heading"><button type="button" className="secondary" onClick={()=>setHistoryOpen(v=>!v)}>
       {historyOpen?'Ocultar histórico':'Ver histórico de verificações'}</button></div>
     {historyOpen&&<ul>{history.map(row=><li key={row.id}>
      {localTime(row.created_at)} · {row.configured==='true'?'Configuração básica válida':'Configuração incompleta'}
     </li>)}{history.length===0&&<li>Nenhuma verificação registrada ainda.</li>}</ul>}
    </section>
   </div>
  </div>
 </section>;
}
