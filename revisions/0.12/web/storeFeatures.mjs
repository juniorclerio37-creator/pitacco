import {useEffect,useState} from 'react';

export const featureLabels={
 alertas:'Alertas',estoque:'Estoque',cardapio:'Meu Cardápio',clientes:'Clientes',
 fideliza:'Fideliza+',financeiro:'Financeiro',caixa:'Caixa',relatorios:'Relatórios',
 motoboys:'Motoboys',integracoes:'Integrações',agendamento:'Agendamento'
};
const tabs={
 Painel:null,Produtos:'cardapio','Importar cardápio':'cardapio',Entregadores:'motoboys',
 'Relatório de motoboys':'motoboys','Pagamento de motoboys':'motoboys',
 Lançamentos:'financeiro',Despesas:'financeiro','Entrega externa':'integracoes',
 WhatsApp:'integracoes'
};
export function featureForTab(name){
 return tabs[name]||Object.keys(featureLabels).find(key=>featureLabels[key]===name);
}
export function useStoreFeatures(client,store){
 const [state,setState]=useState(null);
 useEffect(()=>{
  if(!client||!store)return;
  let live=true,running=false;
  async function update(){
   if(running)return;
   running=true;
   try{
    const result=await client.rpc('pitacco_store_features',{p_store:store});
    if(live&&!result.error&&result.data)setState({store,features:result.data});
   }finally{running=false;}
  }
  update();
  const timer=setInterval(update,30000);
  return()=>{live=false;clearInterval(timer);};
 },[client,store]);
 return state?.store===store?state.features:null;
}
