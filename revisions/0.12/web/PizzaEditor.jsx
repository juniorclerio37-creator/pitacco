import React from 'react';
const field={display:'grid',gap:6,minWidth:0};
const input={width:'100%',minWidth:0,boxSizing:'border-box'};
export const emptyPizza=()=>({rule:'max',sizes:[],flavors:[],extras:[]});
export default function PizzaEditor({value,onChange,disabled=false}){
 const patch=(key,rows)=>onChange({...value,[key]:rows});
 const update=(key,id,p)=>patch(key,value[key].map(x=>x.id===id?{...x,...p}:x));
 const remove=(key,id)=>patch(key,value[key].filter(x=>x.id!==id));
 const add=(key,row)=>patch(key,[...value[key],{id:crypto.randomUUID(),...row}]);
 const money=(v,fn)=><input style={input} type="number" min="0" step=".01" value={v??''} onChange={e=>fn(e.target.value)}/>;
 const label=(name,child)=><label style={field}>{name}{child}</label>;
 const card={display:'grid',gap:10,padding:12,border:'1px solid #aaa',borderRadius:12,minWidth:0};
 return <fieldset disabled={disabled} style={{...card,margin:0}}>
 <legend>Configuração da pizza</legend>
 {label('Regra de cobrança',<select style={input} value={value.rule} onChange={e=>onChange({...value,rule:e.target.value})}><option value="max">Sabor mais caro</option><option value="min">Sabor mais barato</option><option value="avg">Proporcional</option><option value="fixed">Preço fixo por tamanho</option></select>)}
 <h3>Tamanhos</h3>
 {value.sizes.map(s=><div key={s.id} style={card}>
 {label('Nome',<input style={input} value={s.name} onChange={e=>update('sizes',s.id,{name:e.target.value})}/>)}
 {['diameter','slices','maxFlavors'].map((k,i)=><React.Fragment key={k}>{label(['Diâmetro (cm)','Fatias','Máximo de sabores'][i],<input style={input} type="number" min="1" step="1" value={s[k]} onChange={e=>update('sizes',s.id,{[k]:e.target.value})}/>)}</React.Fragment>)}
 {value.rule==='fixed'&&label('Preço fixo (R$)',money(s.fixedPrice,v=>update('sizes',s.id,{fixedPrice:v})))}
 <button type="button" className="secondary" onClick={()=>remove('sizes',s.id)}>Retirar tamanho</button></div>)}
 <button type="button" onClick={()=>add('sizes',{name:'',diameter:35,slices:8,maxFlavors:2,fixedPrice:''})}>+ Tamanho</button>
 <h3>Sabores</h3>
 {value.flavors.map(f=><div key={f.id} style={card}>
 {label('Nome',<input style={input} value={f.name} onChange={e=>update('flavors',f.id,{name:e.target.value})}/>)}
 {label('Descrição',<textarea style={input} value={f.description} onChange={e=>update('flavors',f.id,{description:e.target.value})}/>)}
 {label('Categoria',<select value={f.category} onChange={e=>update('flavors',f.id,{category:e.target.value})}>{['Tradicional','Especial','Premium','Doce'].map(c=><option key={c}>{c}</option>)}</select>)}
 <label><input type="checkbox" checked={f.available} onChange={e=>update('flavors',f.id,{available:e.target.checked})}/> Disponível</label>
 {value.sizes.map(s=><React.Fragment key={s.id}>{label('Preço — '+(s.name||'Tamanho')+' (R$)',money(f.prices[s.id],v=>update('flavors',f.id,{prices:{...f.prices,[s.id]:v}})))}</React.Fragment>)}
 <button type="button" className="secondary" onClick={()=>remove('flavors',f.id)}>Retirar sabor</button></div>)}
 <button type="button" onClick={()=>add('flavors',{name:'',description:'',category:'Tradicional',available:true,prices:{}})}>+ Sabor</button>
 <h3>Bordas, massas e adicionais</h3>
 {value.extras.map(x=><div key={x.id} style={card}>
 {label('Tipo',<select value={x.kind} onChange={e=>update('extras',x.id,{kind:e.target.value})}>{['Borda','Massa','Adicional'].map(k=><option key={k}>{k}</option>)}</select>)}
 {label('Nome',<input style={input} value={x.name} onChange={e=>update('extras',x.id,{name:e.target.value})}/>)}
 {value.sizes.map(s=><React.Fragment key={s.id}>{label('Preço — '+(s.name||'Tamanho')+' (R$)',money(x.prices[s.id],v=>update('extras',x.id,{prices:{...x.prices,[s.id]:v}})))}</React.Fragment>)}
 <button type="button" className="secondary" onClick={()=>remove('extras',x.id)}>Retirar opção</button></div>)}
 <button type="button" onClick={()=>add('extras',{kind:'Borda',name:'',prices:{}})}>+ Opção</button>
 </fieldset>;
}
