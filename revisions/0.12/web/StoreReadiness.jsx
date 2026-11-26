import React,{useEffect,useState} from 'react';
import SupportCenter from './SupportCenter.jsx';
import {Search,BookOpen,Headphones,ChevronDown} from 'lucide-react';
import './support-center-modern.css';

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

const articles=[
 ['Cardápio','Como publico o cardápio?','Cadastre os produtos, configure os pagamentos e a modalidade de atendimento, e ative a publicação em Pagamentos da loja. Confira o link público antes de compartilhar.'],
 ['Entregas','Como configuro as entregas?','Em Dados da loja informe o endereço completo. Em Área de entrega cadastre as regiões, taxas e prazos. Confirme o ponto da loja no mapa. As tarifas por trajeto dependem de homologação.'],
 ['Pedidos','Como recebo e aceito pedidos?','Abra Pedidos no painel. O aceite e as notificações disponíveis dependem da origem do pedido e das integrações homologadas.'],
 ['Financeiro','Como vejo o lucro por pedido?','Acesse Financeiro e o relatório Resultado por pedido. Cadastre os custos diretos para visualizar a estimativa corretamente.'],
 ['Impressão','Como faço para imprimir no navegador?','Em Pedidos, depois de aceitar o pedido, use Imprimir no navegador e escolha a impressora. A impressão pelo navegador é manual por pedido.'],
 ['Impressão','Como ativar a impressão automática?','No Pitacco Windows, faça login, vincule o computador e configure as impressoras por setor. O teste físico de impressão é feito no Windows.'],
 ['Pedidos','O que fazer se pedidos ou impressões falharem?','Abra Alertas e verifique o diagnóstico. No Windows, confira a impressora e a fila do spooler antes de reimprimir. Não reenvie pedidos indiscriminadamente.'],
 ['Integrações','Como acompanho o andamento das integrações?','Na área de Integrações consulte a situação da conexão. Os serviços de parceiros dependem de credenciais e homologação oficiais.'],
 ['Cadastro','Como cadastro meu endereço e o CEP?','Em Dados da loja, informe o CEP, confira rua, bairro, cidade e estado, complete o número e salve. Confirme a entrada da loja no mapa.'],
 ['Aplicativo','Como atualizo o Pitacco Windows?','Use Verificar atualização no menu lateral do aplicativo. Aguarde as impressões pendentes antes de instalar uma atualização assinada.']
];
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function StoreHelp({client,storeId,canContact=true}){
 const [search,setSearch]=useState(''),[topic,setTopic]=useState('');
 const topics=[...new Set(articles.map(a=>a[0]))];
 const visible=articles.filter(a=>(!topic||a[0]===topic)&&normalize(a.join(' ')).includes(normalize(search.trim())));
 return <div className="psc-help"><section className="psc" aria-label="Central de ajuda">
  <div className="psc-hero"><span className="psc-eyebrow">CENTRAL DE AJUDA</span><h3>Como podemos ajudar você?</h3><p>Encontre orientações para usar o Pitacco ou converse com nossa equipe.</p><label className="psc-search"><Search size={20}/><input aria-label="Buscar dúvidas e orientações" placeholder="Ex.: impressão, cardápio, entregas…" value={search} onChange={e=>setSearch(e.target.value)}/></label><button type="button" className="secondary psc-help-link" onClick={()=>document.getElementById('pitacco-support-'+storeId)?.scrollIntoView({behavior:'smooth',block:'start'})}><Headphones size={18}/> Falar com o suporte</button></div>
  <div className="psc-card"><div className="psc-section-head"><div><h4><BookOpen size={19}/> Dúvidas frequentes</h4><p>Orientações rápidas para sua operação.</p></div><small>{visible.length} {visible.length===1?'artigo':'artigos'}</small></div>
   <div className="psc-filter-row" role="group" aria-label="Categorias de ajuda">{['',...topics].map(t=><button type="button" key={t||'all'} aria-pressed={topic===t} onClick={()=>setTopic(t)}>{t||'Todas'}</button>)}</div>
   {visible.length?visible.map(([type,title,answer])=><details className="psc-faq" key={title}><summary><span><small>{type}</small><strong>{title}</strong></span><ChevronDown size={18}/></summary><p>{answer}</p></details>):<div className="psc-empty"><Search size={30}/><strong>Nenhuma orientação encontrada.</strong><p>Tente outro termo ou abra um chamado.</p><button type="button" className="secondary" onClick={()=>{setSearch('');setTopic('')}}>Limpar busca</button></div>}
  </div>
 </section><div id={'pitacco-support-'+storeId}>{canContact?<SupportCenter key={storeId} client={client} storeId={storeId}/>:<section className="psc-card"><p>Para abrir chamados, solicite acesso de gestor ao estabelecimento.</p></section>}</div></div>;
}
