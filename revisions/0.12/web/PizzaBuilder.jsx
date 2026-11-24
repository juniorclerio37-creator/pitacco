import React,{useState} from 'react';
import {quotePizza} from './pizzaPricing.mjs';
const brl=c=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export default function PizzaBuilder({config,onConfirm}){
 const [sizeId,setSize]=useState(''),[selected,setSelected]=useState([]),[extras,setExtras]=useState([]);
 const size=config.sizes.find(s=>s.id===sizeId);
 const flavors=config.flavors.filter(f=>f.available!==false&&Number.isSafeInteger(f.prices?.[sizeId]));
 const options=config.extras.filter(e=>e.available!==false&&Number.isSafeInteger(e.prices?.[sizeId]));
 let quote=null;
 try{if(size)quote=quotePizza({size,flavors,selection:selected,rule:config.rule,extras:extras.map(id=>options.find(e=>e.id===id)?.prices[sizeId])});}catch{}
 const toggleFlavor=id=>setSelected(old=>old.includes(id)?old.filter(x=>x!==id):old.length<size.maxFlavors?[...old,id]:old);
 const toggleExtra=e=>setExtras(old=>old.includes(e.id)?old.filter(id=>id!==e.id):[...old.filter(id=>e.kind==='Adicional'||options.find(x=>x.id===id)?.kind!==e.kind),e.id]);
 return <section style={{display:'grid',gap:16}}>
 <h3>Monte sua pizza</h3>
 <fieldset><legend>Escolha o tamanho</legend>{config.sizes.map(s=><label key={s.id} style={{display:'block',padding:8}}><input type="radio" name="pizza-size" checked={sizeId===s.id} onChange={()=>{setSize(s.id);setSelected([]);setExtras([])}}/> {s.name} · {s.slices} fatias</label>)}</fieldset>
 {size&&<><fieldset><legend>Escolha até {size.maxFlavors} sabores</legend>{flavors.map(f=><label key={f.id} style={{display:'block',padding:8}}><input type="checkbox" checked={selected.includes(f.id)} disabled={!selected.includes(f.id)&&selected.length>=size.maxFlavors} onChange={()=>toggleFlavor(f.id)}/> {f.name} — {brl(f.prices[sizeId])}<small style={{display:'block'}}>{f.description}</small></label>)}</fieldset>
 {['Borda','Massa','Adicional'].map(kind=><fieldset key={kind}><legend>{kind}</legend>{options.filter(e=>e.kind===kind).map(e=><label key={e.id} style={{display:'block',padding:8}}><input type="checkbox" checked={extras.includes(e.id)} onChange={()=>toggleExtra(e)}/> {e.name} · {brl(e.prices[sizeId])}</label>)}</fieldset>)}
 <p aria-live="polite">Total estimado: {quote?brl(quote.total):'Selecione os sabores'}</p>
 <button type="button" disabled={!quote||!onConfirm} onClick={()=>onConfirm({sizeId,flavorIds:selected,extraIds:extras})}>Adicionar ao pedido</button></>}
 </section>;
}
// Expects normalized catalog prices in integer cents. Server validation is required before use in checkout.
