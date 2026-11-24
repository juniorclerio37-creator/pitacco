import {useEffect,useState} from 'react';

export const featureLabels={
 alertas:'Alertas',estoque:'Estoque',cardapio:'Meu Cardápio',clientes:'Clientes',
 fideliza:'Fideliza+',financeiro:'Financeiro',caixa:'Caixa',relatorios:'Relatórios',
 motoboys:'Motoboys',integracoes:'Integrações',agendamento:'Agendamento'
};
const tabs={
 Painel:null,Produtos:'cardapio','Importar cardápio':'cardapio',Entregadores:'motoboys',
 'Relatório de motoboys':'motoboys','Pagamento de motoboys':'motoboys',
 Lançamentos:'financeiro',Despesas:'financeiro','Fiado / Caderneta':'financeiro','Entrega externa':'integracoes',
 'Mapa de entregadores':'motoboys',WhatsApp:'integracoes'
};
export function featureForTab(name){
 return tabs[name]||Object.keys(featureLabels).find(key=>featureLabels[key]===name);
}
export function useStoreFeatures(client,store,user){
 const [state,setState]=useState(null);
 const [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(!client||!store||!user)return;
  let live=true,running=false,queued=false;
  const controller=new AbortController();
  async function update(){
   if(!live)return;
   if(running){queued=true;return;}
   running=true;
   try{
    const result=await client.rpc('pitacco_store_features',{p_store:store}).abortSignal(controller.signal);
    if(result.error||!result.data||typeof result.data!=='object'||Array.isArray(result.data))throw new Error('Módulos indisponíveis');
    if(live)setState({store,user,attempt,status:'ready',features:result.data});
   }catch{
    if(live)setState({store,user,attempt,status:'error',features:null});
   }finally{running=false;if(queued){queued=false;void update()}}
  }
  update();
  const visible=()=>{if(document.visibilityState==='visible')void update()};
  const timer=setInterval(visible,10000);
  document.addEventListener('visibilitychange',visible);window.addEventListener('focus',visible);
  return()=>{live=false;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',visible);};
 },[client,store,user,attempt]);
 const current=state&&state.store===store&&state.user===user&&state.attempt===attempt
  ?state:{status:'loading',features:null};
 return {...current,retry:()=>setAttempt(value=>value+1)};
}
