// Pure, auditable courier remuneration calculation. Distance is the road route from store to customer.
const cents=n=>Math.round((Number(n)+Number.EPSILON)*100);
const nonnegative=(n,label)=>{if(!Number.isFinite(Number(n))||Number(n)<0)throw Error(label+' inválido');return Number(n)};
export function courierEarnings(rule,delivery){
 if(!rule||!delivery)throw Error('Regra e entrega obrigatórias');
 const type=rule.type;
 const km=()=>nonnegative(delivery.road_distance_km,'Distância viária');
 const rate=()=>nonnegative(rule.rate,'Valor da regra');
 let value=0;
 switch(type){
  case 'customer_fee': value=nonnegative(delivery.customer_delivery_fee,'Taxa do cliente');break;
  case 'per_km': value=km()*rate();break;
  case 'per_delivery':value=rate();break;
  case 'daily':value=0;break; // Daily allowance is settled once per worked day, never per delivery.
  case 'mixed':
   value=(rule.customer_fee?nonnegative(delivery.customer_delivery_fee,'Taxa do cliente'):0)
     +(rule.per_km?km()*nonnegative(rule.per_km,'Tarifa por km'):0)
     +(rule.per_delivery?nonnegative(rule.per_delivery,'Valor por entrega'):0);
   break;
  default:throw Error('Tipo de remuneração desconhecido');
 }
 return cents(value)/100;
}
export function courierDailyAllowance(rule,workedDays){
 const daily=rule?.type==='daily'?rule.rate:rule?.type==='mixed'?rule.daily:0;
 return cents(nonnegative(daily||0,'Diária')*nonnegative(workedDays,'Dias trabalhados'))/100;
}
export function courierOutstanding(earned,paid){
 const e=cents(nonnegative(earned,'Total gerado')),p=cents(nonnegative(paid,'Total pago'));
 if(p>e)throw Error('Pagamento excede total gerado');
 return (e-p)/100;
}
