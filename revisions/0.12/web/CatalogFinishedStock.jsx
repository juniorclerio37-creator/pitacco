import React,{useEffect,useMemo,useState} from 'react';
import './catalog-studio-modern.css';

const qty=v=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:3}).format(Number(v||0));
export default function CatalogFinishedStock({client,storeId,products=[],manager=true}){
 const [stock,setStock]=useState([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [search,setSearch]=useState('');
 const productList=useMemo(()=>products.filter(p=>p.name.toLowerCase().includes(search.toLowerCase())),[products,search]);
 async function refresh(){
  setLoading(true);
  try{
   const {data,error:err}=await client.from('pitacco_finished_product_stock').select('product_id,enabled,balance,minimum,updated_at').eq('store_id',storeId);
   if(err)throw err;setStock(data||[]);setError('');
  }catch(e){setError('Não foi possível carregar o controle de produtos acabados: '+(e.message||String(e)))}
  finally{setLoading(false)}
 }
 useEffect(()=>{refresh()},[client,storeId]);
 async function save(product,change){
  if(!manager)return;
  setBusy(product.id);setError('');setNotice('');
  try{
   const current=stock.find(row=>row.product_id===product.id)||{enabled:false,balance:0,minimum:0};
   const updated={...current,...change,store_id:storeId,product_id:product.id,updated_at:new Date().toISOString()};
   updated.balance=Number(updated.balance);updated.minimum=Number(updated.minimum);
   if(!Number.isFinite(updated.balance)||updated.balance<0||!Number.isFinite(updated.minimum)||updated.minimum<0)
     throw Error('Informe quantidades maiores ou iguais a zero.');
   const {error:err}=await client.from('pitacco_finished_product_stock').upsert(updated,{onConflict:'store_id,product_id'});
   if(err)throw err;
   setNotice('Estoque de '+product.name+' atualizado.');
   await refresh();
  }catch(e){setError('Não foi possível salvar: '+(e.message||String(e)))}
  finally{setBusy(null)}
 }
 const tracked=stock.filter(s=>s.enabled);
 const low=tracked.filter(s=>Number(s.balance)<=Number(s.minimum));
 return <section className="catalog-hub" aria-label="Estoque de produtos prontos">
  <header className="catalog-hub-header"><div><span className="eyebrow">PRODUTOS ACABADOS</span><h3>Estoque</h3>
   <p>Controle opcional de produtos prontos, bebidas lacradas e itens industrializados. Para açaí preparado sob demanda, use a ficha técnica de insumos abaixo.</p></div>
   <button type="button" className="secondary" onClick={refresh} disabled={loading||!!busy}>Atualizar estoque</button></header>
  <div className="catalog-stat-row"><span><strong>{products.length}</strong> produtos</span>
   <span><strong>{tracked.length}</strong> com controle ativo</span>
   <span><strong>{low.length}</strong> com saldo mínimo ou abaixo</span></div>
  {error&&<p className="catalog-error" role="alert">{error}</p>}
  {notice&&<p className="catalog-notice" role="status">{notice}</p>}
  {loading&&<p role="status">Carregando estoque…</p>}
  <label className="catalog-stock-search">Pesquisar produto<input placeholder="Buscar no cardápio..." value={search} onChange={e=>setSearch(e.target.value)}/></label>
  <div className="catalog-stock-table"><div className="catalog-stock-table-head"><span>Produto</span><span>Saldo</span><span>Mínimo</span><span>Status</span><span>Ações</span></div>
   {productList.map(product=>{
    const row=stock.find(s=>s.product_id===product.id)||{enabled:false,balance:0,minimum:0};
    const lowStock=row.enabled&&Number(row.balance)<=Number(row.minimum);
    return <div key={product.id} className="catalog-stock-row">
     <div className="catalog-stock-item">{product.image_url?<img src={product.image_url} alt=""/>:<span className="catalog-photo-missing">📦</span>}
      <span><strong>{product.name}</strong><small>{product.category||'Sem categoria'}</small></span></div>
     <span>{row.enabled?qty(row.balance):'—'}</span><span>{row.enabled?qty(row.minimum):'—'}</span>
     <span className={'catalog-stock-status '+(lowStock?'low':row.enabled?'ok':'off')}>{row.enabled?(lowStock?'Estoque baixo':'Disponível'):'Sem controle'}</span>
     <div className="catalog-stock-actions">
      <label><input type="checkbox" checked={!!row.enabled} disabled={!manager||busy===product.id}
       onChange={e=>save(product,{enabled:e.target.checked})}/> Controlar</label>
      {row.enabled&&manager&&<>
       <button type="button" className="secondary" disabled={!!busy} onClick={()=>{
        const input=prompt('Informe o novo estoque mínimo de '+product.name+' (atual: '+row.minimum+'):',String(row.minimum));
        if(input===null)return;
        const val=Number(input.replace(',','.'));if(!Number.isFinite(val)||val<0){setError('Informe um estoque mínimo válido.');return}
        save(product,{minimum:val});
       }}>Mínimo</button>
       <button type="button" className="secondary" disabled={!!busy} onClick={()=>{
        const input=prompt('Informe a quantidade para adicionar ao estoque de '+product.name+':','1');
        if(input===null)return;
        const val=Number(input.replace(',','.'));if(!Number.isFinite(val)||val<=0){setError('Informe uma quantidade válida.');return}
        save(product,{balance:Number(row.balance)+val});
       }}>+ Entrada</button>
       <button type="button" className="secondary" disabled={!!busy} onClick={()=>{
        const input=prompt('Informe a quantidade a retirar do estoque de '+product.name+':','1');
        if(input===null)return;
        const val=Number(input.replace(',','.'));if(!Number.isFinite(val)||val<=0||val>Number(row.balance)){setError('Saldo insuficiente ou quantidade inválida.');return}
        save(product,{balance:Number(row.balance)-val});
       }}>− Saída</button>
      </>}
     </div>
    </div>;
   })}
   {!productList.length&&<p>Nenhum produto encontrado.</p>}
  </div>
  <p className="catalog-hint">O saldo dos produtos acabados é ajustado manualmente. O consumo automático de ingredientes é configurado nas fichas técnicas de Insumos; ativar este controle não desconta automaticamente pedidos já feitos.</p>
 </section>;
}
