// Shared browser/Windows operational board signal lifecycle.
// A signal is never an order object. Keep the complete authoritative refresh.
// The injected source is an explicit integration seam, not a runtime feature flag.
export function connectOperationalRefresh({client,storeId,refresh,experimentalSource=null,
  schedule=setInterval,cancel=clearInterval}){
  let active=true,channel=null,unsubscribe=null;
  const trigger=()=>{if(active)void refresh();};
  trigger();
  const timer=schedule(trigger,5000);
  function legacy(){
    try{
      channel=client.channel('operations:'+storeId);
      channel.on('postgres_changes',{event:'*',schema:'public',table:'orders',filter:'store_id=eq.'+storeId},trigger)
        .on('postgres_changes',{event:'*',schema:'public',table:'deliveries',filter:'store_id=eq.'+storeId},trigger)
        .subscribe(state=>{if(state==='SUBSCRIBED')trigger();});
    }catch{
      // Polling continues if realtime is unavailable.
    }
  }
  // No mixed backend by default. The host must explicitly attest that the
  // refresh reads the same operational dataset as this experimental source.
  if(experimentalSource?.storeId===storeId&&experimentalSource?.sameDataset===true&&
     typeof experimentalSource.subscribe==='function'){
    try{
      const cleanup=experimentalSource.subscribe(trigger);
      if(typeof cleanup!=='function')throw Error('Missing cleanup');
      unsubscribe=cleanup;
    }catch{legacy();}
  }else legacy();
  return ()=>{
    if(!active)return;
    active=false;cancel(timer);
    try{unsubscribe?.();}catch{}
    if(channel){try{void Promise.resolve(client.removeChannel(channel)).catch(()=>{});}catch{}}
  };
}
