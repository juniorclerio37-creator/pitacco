import React,{useEffect,useState} from 'react';
import Papa from 'papaparse';

const platforms={ifood:'iFood','99food':'99Food',keeta:'Keeta'};
const labels={matched:'Conciliado',different:'Divergente',unmatched:'Pedido sem correspondência',ambiguous:'Mais de um pedido encontrado'};
const currency=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const format=value=>value==null?'—':currency.format(value);

function parseNet(value){
 const input=String(value).trim().replace(/^R\$\s*/,'');
 const normalized=input.includes(',')?input.replaceAll('.','').replace(',','.'):input;
 if(!/^-?\d{1,7}(\.\d{1,2})?$/.test(normalized))throw Error('Informe o repasse líquido de cada pedido como um valor decimal, por exemplo 20,50.');
 if(input.includes(',')&&!/^-?(\d+|\d{1,3}(\.\d{3})+),\d{1,2}$/.test(input))throw Error('Um repasse líquido tem separadores inválidos.');
 return normalized;
}
function parseStatement(text){
 const result=Papa.parse(text,{header:true,skipEmptyLines:'greedy',transformHeader:header=>header.trim().toLowerCase()});
 if(result.errors.length||!result.meta.fields?.includes('pedido_externo')||!result.meta.fields?.includes('repasse_liquido')||!result.data.length||result.data.length>500){
  throw Error('O CSV deve ter as colunas pedido_externo e repasse_liquido e conter de 1 a 500 linhas.');
 }
 return result.data.map(row=>({external_order:String(row.pedido_externo||'').trim(),net:parseNet(row.repasse_liquido)}));
}

export default function MarketplaceReconciliation({client,storeId}){
 const [batches,setBatches]=useState([]),[rows,setRows]=useState(null),[selection,setSelection]=useState('');
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);

 async function history(){
  const {data,error}=await client.from('pitacco_marketplace_settlements')
   .select('id,provider,account_reference,settlement_reference,settled_on').eq('store_id',storeId)
   .order('settled_on',{ascending:false}).order('imported_at',{ascending:false}).limit(30);
  if(error)throw error;
  return data;
 }
 useEffect(()=>{
  let mounted=true;
  history().then(data=>{if(mounted)setBatches(data);})
   .catch(failure=>{if(mounted)setError(failure.message||'Não foi possível consultar os repasses.');})
   .finally(()=>{if(mounted)setLoading(false);});
  return()=>{mounted=false;};
 },[storeId]);

 async function loadReport(id){
  setRows(null);
  const {data,error}=await client.rpc('pitacco_marketplace_settlement_report',{p_settlement:id});
  if(error)throw error;
  setSelection(id);
  setRows(data);
 }
 async function submit(event){
  event.preventDefault();
  const form=event.currentTarget;
  const values=new FormData(form);
  setBusy(true);setError('');setNotice('');
  try{
   const file=values.get('statement');
   if(!file?.size||file.size>150000)throw Error('Selecione um CSV de até 150 KB.');
   const {data,error}=await client.rpc('pitacco_import_marketplace_settlement',{
    p_store:storeId,p_provider:values.get('provider'),p_account:values.get('account').trim(),
    p_reference:values.get('reference').trim(),p_settled_on:values.get('date'),p_lines:parseStatement(await file.text())
   });
   if(error)throw error;
   setBatches(await history());
   await loadReport(data);
   form.reset();
   setNotice('Repasse importado.');
  }catch(failure){setError(failure.message||'Não foi possível importar o repasse.');}
  finally{setBusy(false);}
 }
 async function select(event){
  const id=event.target.value;
  setSelection(id);setRows(null);setError('');setNotice('');
  if(!id)return;
  setBusy(true);
  try{await loadReport(id);}
  catch(failure){setError(failure.message||'Não foi possível consultar o repasse.');}
  finally{setBusy(false);}
 }

 return <section className="panel" aria-label="Conciliação de repasses" aria-busy={busy||loading}>
  <h3>Conciliação de repasses</h3>
  <p>Use um CSV com as colunas <code>pedido_externo</code> e <code>repasse_liquido</code>. O valor importado é comparado ao total do pedido menos as taxas registradas no Pitacco.</p>
  <form onSubmit={submit}>
   <label>Marketplace <select name="provider">{Object.entries(platforms).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label>Referência da conta <input name="account" required maxLength={120}/></label>
   <label>Referência do repasse <input name="reference" required maxLength={120}/></label>
   <label>Data do repasse <input type="date" name="date" required/></label>
   <label>Arquivo CSV <input type="file" name="statement" accept=".csv,text/csv" required/></label>
   <button disabled={busy||loading}>{busy?'Processando…':'Importar repasse'}</button>
  </form>
  {error&&<p role="alert">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  {loading&&<p role="status">Carregando repasses…</p>}
  {batches.length>0&&<label>Últimos repasses <select value={selection} disabled={busy} onChange={select}>
   <option value="">Selecione</option>{batches.map(batch=><option key={batch.id} value={batch.id}>
    {platforms[batch.provider]} · {batch.account_reference} · {batch.settlement_reference} · {batch.settled_on}
   </option>)}
  </select></label>}
  {rows&&<div style={{overflowX:'auto'}}>
   <table>
    <thead><tr><th>Pedido externo</th><th>Repasse importado</th><th>Saldo registrado</th><th>Diferença</th><th>Situação</th></tr></thead>
    <tbody>{rows.map(row=><tr key={row.external_order}>
     <td>{row.external_order}</td><td>{format(row.reported_net)}</td><td>{format(row.recorded_net)}</td>
     <td>{format(row.difference)}</td><td>{labels[row.status]}</td>
    </tr>)}</tbody>
   </table>
  </div>}
 </section>;
}
