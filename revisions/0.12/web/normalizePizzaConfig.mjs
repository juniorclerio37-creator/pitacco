export function normalizePizzaConfig(config){
 const money=v=>{const s=String(v??'').trim().replace(',','.');if(!/^\d{1,6}(\.\d{1,2})?$/.test(s))throw Error('Preço inválido');const [a,b='']=s.split('.');return Number(a)*100+Number(b.padEnd(2,'0'));};
 const integer=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<1||n>100)throw Error('Medida ou limite inválido');return n;};
 const name=v=>{if(typeof v!=='string'||!v.trim())throw Error('Nome obrigatório');return v.trim();};
 const unique=rows=>{if(!Array.isArray(rows)||rows.some(x=>typeof x.id!=='string'||!x.id)||new Set(rows.map(x=>x.id)).size!==rows.length)throw Error('Identificadores inválidos');return rows;};
 if(!['max','min','avg','fixed'].includes(config.rule))throw Error('Regra inválida');
 const sizes=unique(config.sizes).map(s=>({...s,name:name(s.name),diameter:integer(s.diameter),slices:integer(s.slices),maxFlavors:integer(s.maxFlavors),...(config.rule==='fixed'?{fixedPrice:money(s.fixedPrice)}:{})}));
 if(!sizes.length)throw Error('Cadastre um tamanho');
 const prices=p=>Object.fromEntries(sizes.filter(s=>p?.[s.id]!=null&&String(p[s.id]).trim()!=='').map(s=>[s.id,money(p[s.id])]));
 const flavors=unique(config.flavors).map(f=>({...f,name:name(f.name),prices:prices(f.prices)}));
 if(sizes.some(s=>!flavors.some(f=>f.available!==false&&Object.hasOwn(f.prices,s.id))))throw Error('Cada tamanho precisa de um sabor disponível');
 const extras=unique(config.extras).map(e=>{if(!['Borda','Massa','Adicional'].includes(e.kind))throw Error('Tipo inválido');return {...e,name:name(e.name),prices:prices(e.prices)};});
 return {rule:config.rule,sizes,flavors,extras};
}
