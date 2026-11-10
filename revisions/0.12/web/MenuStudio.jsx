import React,{useEffect,useMemo,useState} from 'react';
const brl=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const empty=()=>({name:'',description:'',category:'',price:'',cost:'',promotional_price:'',active:true,pdv_code:'',details:'',special_tags:'',availability:'',technical_sheet:'',complement_groups:[],gallery_paths:[]});
const field={display:'grid',gap:5,marginBottom:13};
export default function MenuStudio({client,storeId,products=[],onRefresh}){
 const [draft,setDraft]=useState(empty),[editing,setEditing]=useState(null),[photo,setPhoto]=useState(null),[previewUrl,setPreviewUrl]=useState(''),[filter,setFilter]=useState(''),[selectedCategory,setSelectedCategory]=useState('Todas'),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[section,setSection]=useState('Produtos'),[showEditor,setShowEditor]=useState(false);
 const categories=useMemo(()=>['Todas',...new Set(products.map(p=>p.category).filter(Boolean))],[products]);
 const filtered=products.filter(p=>(selectedCategory==='Todas'||p.category===selectedCategory)&&String(p.name||'').toLowerCase().includes(filter.toLowerCase()));
 useEffect(()=>{if(!photo){setPreviewUrl('');return}const url=URL.createObjectURL(photo);setPreviewUrl(url);return()=>URL.revokeObjectURL(url)},[photo]);
 const change=(k,v)=>setDraft(p=>({...p,[k]:v}));
 const begin=(p)=>{setEditing(p?.id||null);setDraft(p?{...empty(),...p,promotional_price:p.promotional_price??'',details:typeof p.details==='string'?p.details:JSON.stringify(p.details||{}),technical_sheet:JSON.stringify(p.technical_sheet||{}),availability:JSON.stringify(p.availability||{}),special_tags:(p.special_tags||[]).join(', '),complement_groups:p.complement_groups||[]}:empty());setPhoto(null);setShowEditor(true);setNotice('')};
 async function save(e){
  e.preventDefault();setBusy(true);setNotice('');
  try{
   const price=Number(draft.price),cost=Number(draft.cost||0),promo=draft.promotional_price===''?null:Number(draft.promotional_price);
   if(!draft.name.trim()||!Number.isFinite(price)||price<0||!Number.isFinite(cost)||cost<0||promo!==null&&(!Number.isFinite(promo)||promo<0||promo>price))throw Error('Confira nome, preço, custo e promoção.');
   const row={store_id:storeId,name:draft.name.trim(),price,cost,description:draft.description,category:draft.category,active:draft.active,promotional_price:promo,pdv_code:draft.pdv_code,details:JSON.parse(draft.details||'{}'),technical_sheet:JSON.parse(draft.technical_sheet||'{}'),availability:JSON.parse(draft.availability||'{}'),special_tags:draft.special_tags.split(',').map(s=>s.trim()).filter(Boolean),complement_groups:draft.complement_groups};
   if(photo)throw Error('A foto já aparece na prévia, mas ainda não há upload autorizado configurado. Nenhum dado foi perdido; retire a foto para salvar os demais campos.');
   const query=editing?client.from('products').update(row).eq('id',editing).eq('store_id',storeId):client.from('products').insert(row);
   const {error}=await query;if(error)throw error;
   setShowEditor(false);setDraft(empty());setEditing(null);setNotice('Produto salvo.');onRefresh?.();
  }catch(err){setNotice(err.message||String(err))}finally{setBusy(false)}
 }
 async function toggle(p){setBusy(true);const {error}=await client.from('products').update({active:!p.active}).eq('id',p.id).eq('store_id',storeId);setBusy(false);setNotice(error?.message||'Disponibilidade atualizada.');if(!error)onRefresh?.()}
 const addGroup=()=>change('complement_groups',[...draft.complement_groups,{name:'Novo grupo',required:false,min:0,max:1,options:[{name:'Complemento',price:0}]}]);
 const updateGroup=(index,key,value)=>change('complement_groups',draft.complement_groups.map((g,i)=>i===index?{...g,[key]:value}:g));
 return <section className="menu-studio">
 <div className="page-intro"><div><span className="eyebrow">MEU CARDÁPIO</span><h3>Editor de cardápio</h3><p>Gerencie produtos e veja as alterações no cardápio do cliente enquanto edita.</p></div><button type="button" className="secondary" onClick={()=>setNotice('Importação direta do iFood aguardando conexão oficial autorizada para esta loja. Nenhum catálogo foi importado.')}>Importar do iFood</button></div>
 <div className="quick-actions" style={{marginBottom:16}}>{['Produtos','Complementos','Banners','Estoque','Insumos'].map(t=><button type="button" key={t} className={section===t?'':'secondary'} onClick={()=>setSection(t)}>{t}</button>)}</div>
 {notice&&<p className="notice" role="status">{notice}</p>}
 {section!=='Produtos'&&<div className="panel"><h3>{section}</h3><p>{section==='Complementos'?'Os grupos de complementos podem ser cadastrados dentro de cada produto, com prévia ao lado.':'A gestão completa desta seção ainda depende do módulo de catálogo e de sua persistência.'}</p><button type="button" onClick={()=>{setSection('Produtos');begin(null)}}>Ir ao cadastro de produtos</button></div>}
 {section==='Produtos'&&<><div style={{display:'grid',gridTemplateColumns:'minmax(170px,1fr) minmax(340px,3fr)',gap:16}}>
 <div className="panel"><h3>Categorias</h3>{categories.map(c=><button key={c} type="button" className={selectedCategory===c?'active':'secondary'} style={{display:'block',width:'100%',marginBottom:8}} onClick={()=>setSelectedCategory(c)}>{c}</button>)}</div>
 <div className="panel"><div className="line"><h3>Produtos</h3><button onClick={()=>begin(null)}>+ Novo produto</button></div><input aria-label="Buscar produto" placeholder="Buscar produtos..." value={filter} onChange={e=>setFilter(e.target.value)}/>{filtered.map(p=><div className="line" key={p.id}><div><b>{p.name}</b><div><small>{p.category||'Sem categoria'} · {brl(p.promotional_price??p.price)}</small></div></div><div className="quick-actions"><button type="button" className="secondary" onClick={()=>begin(p)}>Editar</button><button type="button" className="secondary" disabled={busy} onClick={()=>toggle(p)}>{p.active===false?'Ativar':'Desativar'}</button></div></div>)}{!filtered.length&&<p>Nenhum produto nesta categoria.</p>}</div>
 </div>
 {showEditor&&<div style={{position:'fixed',inset:0,zIndex:90,background:'rgba(0,0,0,.5)',display:'flex',justifyContent:'flex-end'}}>
 <div style={{background:'var(--background,#fff)',color:'var(--foreground,#222)',height:'100%',width:'min(1100px,100%)',overflowY:'auto',padding:22,boxSizing:'border-box'}}>
 <div className="line"><h3>{editing?'Editar produto':'Novo produto'}</h3><button type="button" className="secondary" onClick={()=>setShowEditor(false)}>Fechar</button></div>
 <div style={{display:'grid',gridTemplateColumns:'minmax(330px,1.4fr) minmax(260px,1fr)',gap:20,alignItems:'start'}}>
 <form onSubmit={save}>
 <label style={field}>Foto do produto (JPG, PNG, WebP)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const f=e.target.files?.[0];if(f&&f.size>5*1024*1024){setNotice('Imagem maior que 5 MB.');return}setPhoto(f||null)}}/></label>
 <label style={field}>Nome<input required maxLength={180} value={draft.name} onChange={e=>change('name',e.target.value)}/></label>
 <label style={field}>Descrição<textarea maxLength={1200} rows={3} value={draft.description} onChange={e=>change('description',e.target.value)}/></label>
 <label style={field}>Categoria<input value={draft.category} onChange={e=>change('category',e.target.value)} list="catalog-categories"/><datalist id="catalog-categories">{categories.filter(x=>x!=='Todas').map(x=><option key={x} value={x}/>)}</datalist></label>
 <label style={field}>Status no delivery<select value={String(draft.active)} onChange={e=>change('active',e.target.value==='true')}><option value="true">Ativo</option><option value="false">Inativo</option></select></label>
 <label style={field}>Preço (R$)<input type="number" min="0" step="0.01" required value={draft.price} onChange={e=>change('price',e.target.value)}/></label>
 <label style={field}>Preço promocional (R$)<input type="number" min="0" step="0.01" value={draft.promotional_price} onChange={e=>change('promotional_price',e.target.value)} placeholder="Opcional"/></label>
 <label style={field}>Custo interno (R$)<input type="number" min="0" step="0.01" value={draft.cost} onChange={e=>change('cost',e.target.value)}/></label>
 <label style={field}>Código PDV<input value={draft.pdv_code} onChange={e=>change('pdv_code',e.target.value)}/></label>
 <details><summary>Detalhes</summary><label style={field}>JSON de detalhes<textarea value={draft.details} onChange={e=>change('details',e.target.value)} placeholder="{}"/></label></details>
 <details open><summary>Complementos</summary><button type="button" className="secondary" onClick={addGroup}>+ Adicionar grupo</button>{draft.complement_groups.map((g,i)=><div className="panel" key={i}><label style={field}>Grupo<input value={g.name} onChange={e=>updateGroup(i,'name',e.target.value)}/></label><label style={field}>Mínimo<input type="number" min="0" value={g.min} onChange={e=>updateGroup(i,'min',Number(e.target.value))}/></label><label style={field}>Máximo<input type="number" min="1" value={g.max} onChange={e=>updateGroup(i,'max',Number(e.target.value))}/></label><label><input type="checkbox" checked={!!g.required} onChange={e=>updateGroup(i,'required',e.target.checked)}/> Obrigatório</label><label style={field}>Opções (uma por linha: Nome | Preço)<textarea value={g.options.map(o=>o.name+' | '+o.price).join('\n')} onChange={e=>updateGroup(i,'options',e.target.value.split('\n').filter(Boolean).map(line=>{const [name,price]=line.split('|');return {name:name.trim(),price:Number(price||0)}}))}/></label><button type="button" className="secondary" onClick={()=>change('complement_groups',draft.complement_groups.filter((_,j)=>j!==i))}>Remover grupo</button></div>)}</details>
 <details><summary>Ficha técnica</summary><textarea value={draft.technical_sheet} onChange={e=>change('technical_sheet',e.target.value)} placeholder="{}"/></details>
 <details><summary>Tags de categorias especiais</summary><input value={draft.special_tags} onChange={e=>change('special_tags',e.target.value)} placeholder="Separe por vírgulas"/></details>
 <details><summary>Disponibilidade de dias e horários</summary><textarea value={draft.availability} onChange={e=>change('availability',e.target.value)} placeholder="{}"/></details>
 <details><summary>Galeria de fotos</summary><p className="hint">Galeria adicional: armazenamento pendente de configuração.</p></details>
 <p className="hint">A prévia é automática. O upload de imagens ainda requer armazenamento seguro configurado; a foto selecionada não é enviada ao salvar.</p>
 <div className="quick-actions"><button type="button" className="secondary" onClick={()=>setShowEditor(false)}>Cancelar</button><button disabled={busy} type="submit">Salvar produto</button></div>
 </form>
 <aside className="panel" style={{position:'sticky',top:0}}><span className="eyebrow">PRÉVIA AUTOMÁTICA · CLIENTE FINAL</span><div style={{border:'1px solid #ddd',borderRadius:18,overflow:'hidden',background:'white',color:'#222',marginTop:12}}>{previewUrl?<img src={previewUrl} alt="Foto selecionada" style={{width:'100%',height:170,objectFit:'cover'}}/>:<div style={{height:150,background:'#f0f1f3',display:'grid',placeItems:'center'}}>Foto do produto</div>}<div style={{padding:14}}><small>{draft.category||'Categoria'}</small><h3>{draft.name||'Nome do produto'}</h3><p>{draft.description||'Descrição do produto'}</p>{draft.promotional_price!==''&&<del>{brl(draft.price)}</del>}<h3>{brl(draft.promotional_price!==''?draft.promotional_price:draft.price)}</h3>{draft.complement_groups.map((g,i)=><div key={i} style={{borderTop:'1px solid #eee',paddingTop:10,marginTop:10}}><b>{g.name}</b><small style={{display:'block'}}>Escolha {g.min} a {g.max} · {g.required?'Obrigatório':'Opcional'}</small>{g.options.map((o,j)=><p key={j} style={{margin:'7px 0'}}>◯ {o.name} · {brl(o.price)}</p>)}</div>)}<button type="button" disabled style={{width:'100%',marginTop:12}}>Adicionar ao pedido</button></div></div><p className="hint">Prévia ilustrativa em tempo real, sem publicação automática.</p></aside>
 </div></div></div>}
 </>}
 </section>;
}
