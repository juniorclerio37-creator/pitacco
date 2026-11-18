import React,{useEffect,useState} from 'react';

const kindLabels={
 enable_store_order_sound:'Reativar o som de novos pedidos do painel da loja'
};
const statusLabels={
 proposed:'Aguardando aprovação',applied:'Aplicada',reverted:'Revertida',rejected:'Rejeitada'
};
const fmt=value=>value?new Intl.DateTimeFormat('pt-BR',{
 timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'
}).format(new Date(value)):'—';

export default function IntelligenceRepairs({client,storeId='',stores=[]}){
 const [data,setData]=useState(null);
 const [loading,setLoading]=useState(false);
 const [working,setWorking]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [revision,setRevision]=useState(0);
 useEffect(()=>{
  let live=true;
  setData(null);setError('');setLoading(true);
  client.rpc('pitacco_owner_repairs',{p_store:storeId||null})
   .then(({data,error})=>{
    if(!live)return;
    if(error)throw error;
    setData(data);
   }).catch(e=>{if(live)setError(e?.message||'Histórico de aprovações indisponível.');})
   .finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;};
 },[client,storeId,revision]);
 const chosen=stores.find(store=>store.id===storeId);
 async function submit(functionName,params,confirmation){
  if(working)return;
  if(confirmation&&!window.confirm(confirmation))return;
  setWorking(true);setError('');setNotice('');
  try{
   const {data,error}=await client.rpc(functionName,params);
   if(error)throw error;
   setNotice(data?.status==='proposed'?'Proposta registrada; ainda não houve alteração.':
    data?.status==='applied'?'Correção aplicada. A ação foi registrada no histórico.':
    data?.status==='reverted'?'Configuração restaurada. A reversão foi registrada.':
    data?.status==='rejected'?'Proposta rejeitada, sem alteração da operação.':'Ação registrada.');
   setRevision(current=>current+1);
  }catch(e){setError(e?.message||'Não foi possível concluir a ação.');}
  finally{setWorking(false);}
 }
 const rows=Array.isArray(data?.rows)?data.rows:[];
 return <section className="panel" aria-label="Correções propostas e aprovação" style={{marginTop:16}}>
  <h3>Central de Correções · Aprovação e reversão</h3>
  <p>As sugestões de investigação da IA <strong>não executam mudanças</strong>. O primeiro
   executor permitido nesta etapa reativa exclusivamente o som de pedidos do <strong>painel da loja</strong>,
   quando já houver uma configuração salva e desabilitada. Isso não corrige o áudio do Windows
   nem as notificações do aplicativo de entregadores.</p>
  <p className="hint">Nenhuma proposta é aplicada sem clicar em Aprovar e confirmar. O sistema verifica
   se a configuração mudou, registra todas as decisões e só permite reversão se o valor original
   ainda puder ser restaurado sem sobrescrever outra alteração.</p>
  <div className="dispatch-actions" style={{gap:12,alignItems:'center',flexWrap:'wrap'}}>
   <button type="button" className="secondary" disabled={loading||working}
    onClick={()=>setRevision(current=>current+1)}>{loading?'Atualizando…':'Atualizar propostas'}</button>
   {storeId&&data?.eligible&&<button type="button" disabled={working||loading}
    onClick={()=>submit('pitacco_owner_repair_propose',{p_store:storeId})}>
    Criar proposta para reativar som da loja
   </button>}
  </div>
  {!storeId&&<p>Selecione um estabelecimento acima para verificar se existe um ajuste de som seguro e reversível.</p>}
  {storeId&&data?.selected_sound?.configured&&<p>
   <strong>{chosen?.name||'Loja selecionada'}</strong> · Som do painel:
   {' '}{data.selected_sound.enabled?'habilitado':'desabilitado'} · Volume:
   {' '}{data.selected_sound.volume}/100
  </p>}
  {storeId&&data&&!data.selected_sound&&<p>Esta loja ainda não possui uma configuração de som salva. Não será criada uma configuração automaticamente.</p>}
  {storeId&&data?.selected_sound?.enabled&&<p>O som do painel dessa loja já está habilitado; não há reparo a propor.</p>}
  {error&&<p role="alert">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  {loading&&<p role="status">Consultando propostas…</p>}
  {data&&rows.length===0&&<p>Nenhuma proposta registrada para este filtro.</p>}
  {rows.map(proposal=><article key={proposal.id} className="panel" style={{margin:'12px 0',padding:14}}>
   <h4>{kindLabels[proposal.kind]||'Correção técnica'}</h4>
   <p><strong>{proposal.store_name}</strong> · {statusLabels[proposal.status]||proposal.status}</p>
   <p><small>Criada em {fmt(proposal.created_at)} ·
    {proposal.status==='applied'?' Aplicada em '+fmt(proposal.applied_at):
     proposal.status==='reverted'?' Revertida em '+fmt(proposal.reverted_at):
     proposal.status==='rejected'?' Rejeitada em '+fmt(proposal.rejected_at):
     ' Nenhuma alteração aplicada'}</small></p>
   <p className="hint">Altera somente o campo de habilitação de som da loja; preserva o volume
    configurado. Não modifica pedidos, pagamentos, impressão ou integrações.</p>
   {proposal.status==='proposed'&&<div className="dispatch-actions" style={{gap:8}}>
    <button type="button" disabled={working} onClick={()=>submit(
     'pitacco_owner_repair_decide',{p_proposal:proposal.id,p_action:'apply'},
     'Aprovar e REATIVAR o som do painel desta loja? Esta ação altera uma configuração real e será auditada.'
    )}>Aprovar e aplicar</button>
    <button type="button" className="secondary" disabled={working} onClick={()=>submit(
     'pitacco_owner_repair_decide',{p_proposal:proposal.id,p_action:'reject'},
     'Rejeitar esta proposta sem fazer alterações?'
    )}>Rejeitar</button>
   </div>}
   {proposal.status==='applied'&&<button type="button" className="secondary" disabled={working}
    onClick={()=>submit('pitacco_owner_repair_decide',{p_proposal:proposal.id,p_action:'revert'},
     'Reverter a configuração de som ao estado anterior? Se ela foi modificada depois, a reversão será bloqueada.'
    )}>Reverter alteração</button>}
  </article>)}
  <p className="hint">Correções de impressão, iFood, 99Food, Keeta, Firebase e pagamento
   continuam <strong>somente investigativas</strong> até existir um executor específico com testes,
   confirmação do serviço externo e plano de reversão.</p>
 </section>;
}
