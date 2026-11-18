import React,{useEffect,useState} from 'react';

const count=n=>Number.isSafeInteger(n)&&n>=0?n:'—';
const label=(value,yes='OK',no='Pendente')=>value===true?yes:value===false?no:'Não verificado';
const date=value=>{
 const d=new Date(value);
 return value&&!Number.isNaN(d.getTime())?d.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'não registrado';
};
const testStatus={awaiting_confirmation:'Enviado ao spooler; sem confirmação física',printed:'Operador confirmou papel impresso',failed:'Operador informou falha',uncertain:'Operador não confirmou'};

export default function RecoveryPreflight({client,storeId=''}) {
 const [result,setResult]=useState(null),[error,setError]=useState(''),
  [loading,setLoading]=useState(false),[revision,refresh]=useState(0);
 useEffect(()=>{
  let live=true;setResult(null);setError('');setLoading(true);
  client.rpc('pitacco_owner_recovery_preflight',{p_store:storeId||null})
   .then(({data,error})=>{
    if(!live)return;
    if(error)throw error;
    if(!data?.courier_push||!data?.windows)throw Error('Diagnóstico incompleto');
    setResult(data);
   }).catch(e=>{if(live)setError(e?.message||'Não foi possível verificar a operação.')})
   .finally(()=>{if(live)setLoading(false)});
  return()=>{live=false};
 },[client,storeId,revision]);
 const push=result?.courier_push||{},windows=result?.windows||{};
 const prerequisites=push.server_enabled===true&&push.cron_active===true&&
  push.cron_secret_present===true&&push.registered_devices>0&&push.native_protocol_ready===true;
 return <section className="panel" aria-label="Pré-verificação de recuperação" style={{marginTop:16}}>
  <div className="dispatch-actions" style={{alignItems:'center',justifyContent:'space-between',flexWrap:'wrap'}}>
   <h3 style={{margin:0}}>Pré-verificação de recuperação</h3>
   <button type="button" className="secondary" disabled={loading} onClick={()=>refresh(x=>x+1)}>
    {loading?'Verificando…':'Verificar novamente'}
   </button>
  </div>
  <p>Leitura do servidor sem reiniciar programas, reenviar notificações, imprimir ou modificar pedidos.</p>
  {loading&&<p role="status">Consultando requisitos operacionais…</p>}
  {error&&<p role="alert">{error}</p>}
  {result&&<>
   <p className="hint">Consultado em {date(result.observed_at)} · {storeId?'Loja selecionada':'Todas as lojas'}</p>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,16rem),1fr))',gap:12}}>
    <article className="panel" style={{padding:14}}>
     <h4>Alertas do entregador</h4>
     <p>Envio no servidor: <strong>{label(push.server_enabled,'Habilitado','Desabilitado')}</strong></p>
     <p>Agendamento Firebase: <strong>{label(push.cron_active,'Ativo','Inativo')}</strong></p>
     <p>Segredo do cron: <strong>{label(push.cron_secret_present,'Presente','Ausente')}</strong></p>
     <p>Protocolo Android: <strong>{label(push.native_protocol_ready)}</strong></p>
     <p>Dispositivos registrados: <strong>{count(push.registered_devices)}</strong>.
      {' '}Nativos: <strong>{count(push.native_devices)}</strong>.</p>
     <p>{prerequisites?'Requisitos internos detectados, mas a conta Firebase e o som real ainda precisam de teste.':
      'Há impedimentos para envio confiável. Não habilite o serviço sem validar o Firebase.'}</p>
     <p className="hint"><strong>Verificação:</strong> configurar a conta de serviço FCM, o segredo no Vault
      e o agendamento; entrar no APK, conceder permissão e testar atribuição real em segundo plano.
      Nenhum segredo é exibido nesta tela.</p>
    </article>
    <article className="panel" style={{padding:14}}>
     <h4>Impressão Windows</h4>
     <p>Computadores registrados: <strong>{count(windows.registered_computers)}</strong></p>
     <p>Ativos nos últimos 90 s: <strong>{count(windows.recently_connected_computers)}</strong></p>
     <p>Vinculações de impressão: <strong>{count(windows.bound_print_computers)}</strong></p>
     <p>Falhas em 24 h: <strong>{count(windows.print_error_jobs_24h)}</strong>.
      {' '}Em espera acima de 10 min: <strong>{count(windows.waiting_over_10m_24h)}</strong>.</p>
     <p>Último teste: <strong>{testStatus[windows.latest_operator_test?.outcome]||'Não há registro'}</strong>.
      {windows.latest_operator_test?.submitted_at?' '+date(windows.latest_operator_test.submitted_at):''}</p>
     <p className="hint"><strong>Verificação:</strong> abrir o Pitacco Windows, confirmar o computador
      vinculado e executar o teste de impressora no aplicativo. Registrar se o papel realmente saiu.
      Não reimprimir pedidos automaticamente.</p>
     {!storeId&&<p className="hint">Selecione uma loja acima para verificar seu contexto específico.</p>}
    </article>
   </div>
   <p className="hint">Envio ao spooler não comprova papel impresso; push enviado não comprova
    som ouvido. Dados de presença não são teste físico. Nenhuma alteração foi executada.</p>
  </>}
 </section>;
}
