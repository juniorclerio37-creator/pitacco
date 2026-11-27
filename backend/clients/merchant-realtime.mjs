// Experimental merchant adapter; not imported by the live panel or Windows.
// All events are hints; only an authorized API response supplies order data.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function createMerchantRealtime({store,token,onState,fetcher=globalThis.fetch,limit=50,offset=0}) {
  if(!UUID.test(store??'')||typeof token!=='string'||!token||typeof onState!=='function'||
     !Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>10000)
    throw new TypeError('Configuração de sessão inválida.');
  const channel='private-pitacco.store.'+store;
  const path='/api/v1/stores/'+store+'/orders?limit='+limit+'&offset='+offset;
  let active=true,online=false,dirty=false,flight=null,abort=null,last=null;
  const seen=new Set();
  const notify=(state,data=last)=>onState({state,online,data});
  function stop(){
    if(!active)return;
    active=false;online=false;dirty=false;last=null;seen.clear();abort?.abort();token='';
    notify('stopped',null);
  }
  function refresh(){
    if(!active)return Promise.resolve();
    dirty=true;
    if(flight)return flight;
    flight=Promise.resolve().then(async()=>{
      while(active&&dirty){
        dirty=false;abort=new AbortController();
        try{
          const res=await fetcher(path,{headers:{Accept:'application/json',Authorization:'Bearer '+token},
            cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',
            signal:AbortSignal.any([abort.signal,AbortSignal.timeout(8000)])});
          if(!active)return;
          if([401,403,404].includes(res.status)){
            active=false;online=false;dirty=false;last=null;seen.clear();token='';
            notify('unauthorized',null);return;
          }
          if(!res.ok){dirty=false;notify(res.status===429?'rate_limited':'stale');return;}
          const body=await res.json();
          if(!active)return;
          if(!Array.isArray(body?.data)||body.limit!==limit||body.offset!==offset){
            dirty=false;notify('stale');return;
          }
          last=body.data;notify('ready');
        }catch{
          if(active){dirty=false;notify('stale');}
        }finally{abort=null;}
      }
    }).finally(()=>{flight=null;});
    return flight;
  }
  function connected(){
    if(!active)return Promise.resolve();
    online=true;
    return refresh(); // initial connection and every reconnect recover missed changes
  }
  function disconnected(){
    if(!active)return;
    online=false;notify('stale');
  }
  function receive(frame){
    if(!active||!online||frame?.event!=='pitacco.invalidate'||frame.channel!==channel)return Promise.resolve();
    let data;
    try{data=typeof frame.data==='string'?JSON.parse(frame.data):frame.data;}catch{return Promise.resolve();}
    if(data?.resource!=='orders'||!UUID.test(data.event_id??'')||Object.keys(data).length!==2)return Promise.resolve();
    if(seen.has(data.event_id))return Promise.resolve();
    seen.add(data.event_id);
    if(seen.size>512)seen.delete(seen.values().next().value);
    return refresh();
  }
  return {channel,connected,disconnected,receive,refresh,stop};
}
