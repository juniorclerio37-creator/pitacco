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
