import React,{useEffect,useMemo,useState} from 'react';
const brl=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export default function MenuStudio({client,storeId,products=[],onRefresh}){
 const [draft,setDraft]=useState({name:'',description:'',category:'',price:'',cost:'',image:''});
 const [photo,setPhoto]=useState(null),[previewUrl,setPreviewUrl]=useState('');
 const [filter,setFilter]=useState(''),[selectedCategory,setSelectedCategory]=useState('Todas');
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const categories=useMemo(()=>['Todas',...new Set(products.map(p=>p.category).filter(Boolean))],[products]);
 const filtered=products.filter(p=>(selectedCategory==='Todas'||p.category===selectedCategory)&&p.name.toLowerCase().includes(filter.toLowerCase()));
 useEffect(()=>{if(!photo){setPreviewUrl('');return}const url=URL.createObjectURL(photo);setPreviewUrl(url);return()=>URL.revokeObjectURL(url)},[photo]);
 const change=(k,v)=>setDraft(p=>({...p,[k]:v}));
 async function save(e){
  e.preventDefault();setBusy(true);setNotice('');
  try{
   if(photo)throw Error('A foto está na prévia, mas o armazenamento de imagens ainda precisa ser configurado para esta loja. Salve o produto sem foto por enquanto.');
   const price=Number(draft.price),cost=Number(draft.cost||0);
   if(!draft.name.trim()||!Number.isFinite(price)||price<0||!Number.isFinite(cost)||cost<0)throw Error('Preencha nome, preço e custo válidos.');
   const row={store_id:storeId,name:draft.name.trim(),price,cost};
   const {error}=await client.from('products').insert(row);if(error)throw error;
   setDraft({name:'',description:'',category:'',price:'',cost:'',image:''});setPhoto(null);setNotice('Produto salvo. Os campos avançados serão ativados após a migração do catálogo.');onRefresh?.();
  }catch(err){setNotice(err.message||String(err))}finally{setBusy(false)}
 }
 return <section className="menu-studio">
 <div className="page-intro"><div><span className="eyebrow">MEU CARDÁPIO</span><h3>Editor de cardápio</h3><p>Cadastre seus produtos acompanhando a apresentação para o cliente.</p></div><button type="button" className="secondary" onClick={()=>setNotice('A importação direta depende da conexão oficial do iFood com esta loja. Ainda não está habilitada; nenhum catálogo foi importado.')}>Importar do iFood</button></div>
 {notice&&<p className="notice" role="status">{notice}</p>}
 <div style={{display:'grid',gridTemplateColumns:'minmax(170px,0.7fr) minmax(290px,1.4fr) minmax(260px,1fr)',gap:16,alignItems:'start'}}>
 <div className="panel"><h3>Categorias</h3>{categories.map(c=><button key={c} type="button" className={selectedCategory===c?'active':'secondary'} style={{display:'block',width:'100%',marginBottom:8}} onClick={()=>setSelectedCategory(c)}>{c}</button>)}</div>
 <div><div className="panel"><h3>Produtos cadastrados</h3><input aria-label="Buscar produto" placeholder="Buscar produtos..." value={filter} onChange={e=>setFilter(e.target.value)}/>{filtered.map(p=><div className="line" key={p.id}><b>{p.name}</b><span>{brl(p.price)}</span></div>)}{!filtered.length&&<p>Nenhum produto nesta categoria.</p>}</div>
 <form className="panel" onSubmit={save}><h3>Novo produto</h3>
 <label className="field">Nome<input required value={draft.name} onChange={e=>change('name',e.target.value)} placeholder="Ex.: Açaí 500 ml"/></label>
 <label className="field">Descrição<textarea rows={3} value={draft.description} onChange={e=>change('description',e.target.value)} placeholder="Como o cliente verá o produto"/></label>
 <label className="field">Categoria<input list="menu-categories" value={draft.category} onChange={e=>change('category',e.target.value)}/><datalist id="menu-categories">{categories.filter(c=>c!=='Todas').map(c=><option key={c} value={c}/>)}</datalist></label>
 <label className="field">Preço (R$)<input required min="0" step="0.01" type="number" value={draft.price} onChange={e=>change('price',e.target.value)}/></label>
 <label className="field">Custo (R$)<input min="0" step="0.01" type="number" value={draft.cost} onChange={e=>change('cost',e.target.value)}/></label>
 <label className="field">Foto do produto (prévia local)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const f=e.target.files?.[0];if(f&&f.size>5*1024*1024){setNotice('Imagem acima de 5 MB.');return}setPhoto(f||null)}}/></label>
 <p className="hint">Descrição, categoria e foto já aparecem na prévia, mas ainda não são persistidas pelo cadastro básico. Não serão descartadas silenciosamente ao salvar.</p>
 <button disabled={busy||!!photo||!!draft.description.trim()||!!draft.category.trim()} type="submit">Salvar produto básico</button>
 </form></div>
 <div className="panel" style={{position:'sticky',top:16}}><span className="eyebrow">PRÉVIA DO CLIENTE · EM TEMPO REAL</span><div style={{maxWidth:320,margin:'12px auto',border:'1px solid #ddd',borderRadius:20,overflow:'hidden',background:'#fff',color:'#222'}}>{previewUrl?<img src={previewUrl} alt="Prévia da foto do produto" style={{width:'100%',height:180,objectFit:'cover'}}/>:<div style={{height:150,background:'#f1f2f4',display:'grid',placeItems:'center'}}>Foto do produto</div>}<div style={{padding:16}}><small>{draft.category||'Categoria'}</small><h3>{draft.name||'Nome do produto'}</h3><p>{draft.description||'Descrição do produto aparecerá aqui.'}</p><b>{brl(draft.price)}</b><button type="button" disabled style={{display:'block',marginTop:12,width:'100%'}}>Adicionar ao pedido</button></div></div><p className="hint">Simulação visual; não publica o produto automaticamente.</p></div>
 </div></section>;
}
