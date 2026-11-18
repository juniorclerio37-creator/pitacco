import React from 'react';

// Fonte compartilhada para cadastro e edição das regras do motoboy.
export const remunerationModes=[
 {value:'customer_fee',label:'Taxa original de entrega',help:'Recebe 100% do frete calculado antes de descontos ou cupons. Mesmo com frete grátis promocional.'},
 {value:'per_delivery',label:'Valor fixo por entrega',help:'Recebe um valor definido pela loja a cada entrega concluída.'},
 {value:'per_km',label:'Por quilômetro',help:'Valor por quilômetro de trajeto viário verificado. Sem rota validada, o repasse fica pendente de conferência.'},
 {value:'daily',label:'Diária',help:'Uma diária por dia com entrega concluída, sem multiplicar por pedido.'},
 {value:'mixed',label:'Diária + valor por entrega',help:'Uma diária por dia trabalhado, somada ao valor por cada entrega concluída.'},
];
export const emptyRemuneration={mode:'customer_fee',rate:0,daily_rate:0,km_rate:0,per_delivery_rate:0,include_customer_fee:true};

export function normalizeRemuneration(input){
 const mode=remunerationModes.some(x=>x.value===input?.mode)?input.mode:'customer_fee';
 return {
  mode,rate:0,
  daily_rate:mode==='daily'||mode==='mixed'?Number(input?.daily_rate||0):0,
  per_delivery_rate:mode==='per_delivery'||mode==='mixed'?Number(input?.per_delivery_rate||0):0,
  km_rate:mode==='per_km'?Number(input?.km_rate||0):0,
  include_customer_fee:mode==='customer_fee'
 };
}
export function validateRemuneration(input){
 const value=normalizeRemuneration(input);
 if(!remunerationModes.some(x=>x.value===input?.mode))return 'Selecione um modelo de remuneração.';
 for(const key of ['daily_rate','km_rate','per_delivery_rate']){
  if(!Number.isFinite(value[key])||value[key]<0||value[key]>9999.99)return 'Informe um valor de pagamento válido.';
 }
 if(value.mode==='per_delivery'&&value.per_delivery_rate<=0)return 'Informe o valor fixo de cada entrega.';
 if(value.mode==='per_km'&&value.km_rate<=0)return 'Informe o valor por quilômetro.';
 if((value.mode==='daily'||value.mode==='mixed')&&value.daily_rate<=0)return 'Informe o valor da diária.';
 if(value.mode==='mixed'&&value.per_delivery_rate<=0)return 'Informe também o valor por entrega.';
 return '';
}
export function remunerationLabel(input){
 const values=normalizeRemuneration(input);
 if(!input?.mode)return 'Remuneração não configurada';
 const money=n=>Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 if(values.mode==='customer_fee')return '100% do frete original';
 if(values.mode==='per_delivery')return money(values.per_delivery_rate)+' por entrega';
 if(values.mode==='per_km')return money(values.km_rate)+' por km';
 if(values.mode==='daily')return money(values.daily_rate)+' por dia';
 return money(values.daily_rate)+'/dia + '+money(values.per_delivery_rate)+'/entrega';
}
export default function CourierRemunerationFields({value,onChange,disabled=false}){
 const data=normalizeRemuneration(value);
 const option=remunerationModes.find(x=>x.value===data.mode);
 const change=(key,next)=>onChange({...data,[key]:next});
 const amount=(key,label)=><label className="field" key={key}>{label}
  <input type="number" min="0" max="9999.99" step="0.01"
   value={value?.[key]??0} disabled={disabled} required
   onChange={event=>change(key,event.target.value)}/></label>;
 return <fieldset className="pitacco-driver-remuneration" disabled={disabled}>
  <legend>Modelo de remuneração</legend>
  <label className="field">Como este entregador será pago?
   <select required value={data.mode} onChange={event=>onChange(normalizeRemuneration({mode:event.target.value}))}>
    {remunerationModes.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}
   </select>
  </label>
  <p className="pitacco-driver-remuneration-help">{option?.help}</p>
  {(data.mode==='per_delivery'||data.mode==='mixed')&&amount('per_delivery_rate','Valor por entrega (R$)')}
  {data.mode==='per_km'&&amount('km_rate','Valor por quilômetro (R$)')}
  {(data.mode==='daily'||data.mode==='mixed')&&amount('daily_rate','Valor da diária (R$)')}
  {data.mode==='customer_fee'&&<p className="pitacco-driver-remuneration-example">Exemplo: frete original de R$ 8,00, desconto de R$ 8,00 e cliente com frete grátis → motoboy recebe R$ 8,00.</p>}
 </fieldset>;
}
