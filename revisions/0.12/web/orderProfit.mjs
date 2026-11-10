// Monetary amounts in BRL. Unknown costs must remain unknown, never silently become zero.
const amount=(value,label)=>{if(value===null||value===undefined||value==='')return null;const n=Number(value);if(!Number.isFinite(n)||n<0)throw Error(label+' inválido');return Math.round((n+Number.EPSILON)*100)};
const brl=c=>Math.round(c)/100;
export function orderProfit(input){
 if(!input)throw Error('Pedido obrigatório');
 const revenue=amount(input.customer_paid,'Receita');
 const discounts=amount(input.merchant_discount,'Desconto da loja');
 const platformFees=amount(input.platform_fees,'Taxas da plataforma');
 const processingFees=amount(input.processing_fees,'Taxas de pagamento');
 const delivery=amount(input.delivery_cost,'Custo da entrega');
 const goods=amount(input.goods_cost,'Custo dos produtos');
 const other=amount(input.other_cost,'Outras despesas');
 const fields={revenue,discounts,platformFees,processingFees,delivery,goods,other};
 const missing=Object.entries(fields).filter(([,v])=>v===null).map(([key])=>key);
 if(missing.length)return {complete:false,missing,profit:null,margin:null};
 const profit=revenue-discounts-platformFees-processingFees-delivery-goods-other;
 return {complete:true,missing:[],profit:brl(profit),margin:revenue?Math.round(profit/revenue*10000)/100:null};
}
export function summarizeChannels(orders){
 const groups=new Map();
 for(const o of orders){const channel=String(o.channel||'desconhecido');const row=groups.get(channel)||{channel,count:0,known:0,profit:0,missing:0};row.count++;const calc=orderProfit(o);if(calc.complete){row.known++;row.profit=brl(Math.round(row.profit*100)+Math.round(calc.profit*100))}else row.missing++;groups.set(channel,row)}
 return [...groups.values()].map(row=>({...row,profit:row.missing?null:row.profit}));
}
