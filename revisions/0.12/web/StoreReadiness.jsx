import React,{useEffect,useState} from 'react';
import SupportCenter from './SupportCenter.jsx';

const checklist=[
 ['identity','Identificação da loja','Informe o nome do estabelecimento em Dados da loja.'],
 ['address','Endereço da loja','Informe rua, cidade e estado em Dados da loja.'],
 ['products','Produtos publicados','Cadastre e ative ao menos um produto no cardápio.'],
 ['payments','Formas de pagamento','Selecione ao menos uma forma de pagamento em Pagamentos da loja.'],
 ['fulfillment','Modalidade de atendimento','Ative entrega ou retirada em Pagamentos da loja.'],
 ['published','Cardápio público','Publique seu cardápio após conferir todas as informações.']
];

export function StoreReadiness({client,storeId}){
 const [result,setResult]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [refresh,setRefresh]=useState(0);
 useEffect(()=>{
  if(!client||!storeId)return;
  let live=true;setBusy(true);setError('');
  client.rpc('pitacco_store_readiness',{p_store:storeId}).then(({data,error})=>{
   if(!live)return;
   if(error)throw error;
   setResult(data);
  }).catch(failure=>{if(live)setError(failure.message||'Não foi possível verificar a configuração.');})
   .finally(()=>{if(live)setBusy(false)});
  return()=>{live=false};
 },[client,storeId,refresh]);
 const checks=result?.checks||{};
 const done=checklist.filter(([code])=>checks[code]===true).length;
 return <section className="panel" aria-label="Preparação da loja">
  <div className="dispatch-actions"><h3>Primeiros passos · Verificação da loja</h3>
   <button type="button" className="secondary" disabled={busy} onClick={()=>setRefresh(n=>n+1)}>Verificar novamente</button>
  </div>
  <p>O Pitacco verifica informações gravadas no sistema antes da publicação. Esta verificação não simula pedidos nem substitui os testes de impressão e integração.</p>
  {busy&&!result&&<p role="status">Conferindo a loja…</p>}
  {error&&<p role="alert">{error}</p>}
  {result&&<>
   <p><strong>{done} de {checklist.length} etapas concluídas</strong> · {result.ready?'Cadastro básico pronto para testes':'Complete as etapas pendentes'}</p>
   <progress value={done} max={checklist.length} style={{width:'100%'}}>{done} de {checklist.length}</progress>
   <ul>{checklist.map(([code,label,tip])=><li key={code} style={{margin:'9px 0'}}>
    <strong>{checks[code]?'✓':'○'} {label}</strong> · <span>{checks[code]?'Concluída':tip}</span>
   </li>)}</ul>
  </>}
 </section>;
}

export function StoreHelp({client,storeId}){
 return <><section className="panel" aria-label="Central de ajuda">
  <h3>Ajuda e orientações</h3>
  <p>Respostas rápidas para configurar e operar o Pitacco.</p>
  <details><summary>Como publico o cardápio?</summary><p>Cadastre os produtos, configure os pagamentos e a modalidade de atendimento, e ative a publicação em Pagamentos da loja. Confira o link público antes de compartilhar.</p></details>
  <details><summary>Como configuro as entregas?</summary><p>Em Dados da loja informe o endereço completo. Em Área de entrega cadastre o raio e as taxas. As novas tarifas por trajeto só serão ativadas depois da homologação do serviço de rotas.</p></details>
  <details><summary>Como recebo e aceito pedidos?</summary><p>Abra Pedidos no painel. O aceite e as notificações disponíveis dependem da origem do pedido e das integrações homologadas.</p></details>
  <details><summary>Como vejo o lucro por pedido?</summary><p>Acesse Financeiro e o relatório Resultado por pedido. Cadastre os custos diretos para visualizar a estimativa corretamente.</p></details>
  <details><summary>O que fazer se pedidos ou impressões falharem?</summary><p>Abra Alertas e verifique o diagnóstico. Para problemas de impressão, confira se o aplicativo Windows está conectado e se a impressora está selecionada. Não reenvie pedidos indiscriminadamente.</p></details>
  <details><summary>Como acompanho o andamento das integrações?</summary><p>Na área de Integrações consulte a situação da conexão. Os serviços de parceiros dependem de credenciais e homologação oficiais.</p></details>
 </section><SupportCenter client={client} storeId={storeId}/></>;
}
