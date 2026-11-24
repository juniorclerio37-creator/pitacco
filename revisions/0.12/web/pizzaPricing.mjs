// Pure pricing foundation; amounts are integer BRL cents.
// Not a checkout authorization boundary: the server must load trusted catalog data.
export function quotePizza({size,flavors,selection,rule='max',extras=[]}){
 const cents=n=>{if(!Number.isSafeInteger(n)||n<0)throw Error('Preço inválido');return n};
 if(!size?.id||!Number.isInteger(size.maxFlavors)||size.maxFlavors<1||size.maxFlavors>100)throw Error('Tamanho inválido');
 if(!Array.isArray(selection)||!selection.length||selection.length>size.maxFlavors||new Set(selection).size!==selection.length)throw Error('Quantidade de sabores inválida');
 const prices=selection.map(id=>{
  const f=flavors.find(x=>x.id===id);
  if(!f||f.available===false||!Object.hasOwn(f.prices||{},size.id))throw Error('Sabor indisponível para este tamanho');
  return cents(f.prices[size.id]);
 });
 let base;
 switch(rule){
 case 'max':base=Math.max(...prices);break;
 case 'min':base=Math.min(...prices);break;
 case 'avg':base=Math.round(prices.reduce((a,b)=>a+b,0)/prices.length);break;
 case 'fixed':base=cents(size.fixedPrice);break;
 default:throw Error('Regra de cobrança inválida');
 }
 const extraTotal=extras.reduce((a,b)=>a+cents(b),0);
 return {base,extraTotal,total:cents(base+extraTotal),portions:selection.map(id=>({id,numerator:1,denominator:selection.length}))};
}

export function quotePizzaSelection(config,{sizeId,flavorIds,extraIds}){
 const size=config?.sizes?.find(s=>s.id===sizeId);
 if(!size||!Array.isArray(flavorIds)||!Array.isArray(extraIds))throw Error('Montagem inválida');
 const ids=[sizeId,...flavorIds,...extraIds];
 if(ids.length>100||new Set(ids).size!==ids.length)throw Error('Opções inválidas ou repetidas');
 const selectedExtras=extraIds.map(id=>{const e=config.extras.find(e=>e.id===id);if(!e||e.available===false||!Object.hasOwn(e.prices||{},sizeId)||!['Borda','Massa','Adicional'].includes(e.kind))throw Error('Adicional indisponível');return e});
 if(['Borda','Massa'].some(k=>selectedExtras.filter(e=>e.kind===k).length>1))throw Error('Escolha somente uma borda e uma massa');
 const q=quotePizza({size,flavors:config.flavors,selection:flavorIds,rule:config.rule,extras:selectedExtras.map(e=>e.prices[sizeId])});
 return {...q,options:ids.sort(),names:[size.name,...flavorIds.map(id=>config.flavors.find(f=>f.id===id).name),...selectedExtras.map(e=>e.name)]};
}
