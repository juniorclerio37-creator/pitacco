// Experimental transport; never sends the bearer token over a WebSocket.
import {createMerchantRealtime} from './merchant-realtime.mjs';
export function createMerchantReverb({store,token,key,onState,fetcher=globalThis.fetch,
  socketFactory=url=>new WebSocket(url),origin=globalThis.location?.origin,
  testLoopback=false,limit=50,offset=0,schedule=setTimeout,cancel=clearTimeout}) {
  if(typeof key!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(key))throw new TypeError('Chave inválida.');
  const base=new URL(origin);
  if(base.protocol!=='https:'&&!(testLoopback&&base.protocol==='http:'&&base.hostname==='127.0.0.1'))throw new TypeError('Origem insegura.');
  const url=new URL('/app/'+key,base);
  url.protocol=base.protocol==='https:'?'wss:':'ws:';
  url.search='protocol=7&client=js&version=8.4.0';
  let stopped=false,started=false,socket=null,retry=null,watch=null,check=null,attempt=0,auth=null,phase='idle';
  const clear=(id)=>{if(id!==null)cancel(id);};
  const adapter=createMerchantRealtime({store,token,fetcher,limit,offset,onState:s=>{
    if(s.state==='unauthorized')shutdown(false);
    onState(s);
  }});
  function shutdown(notify=true){
    if(stopped)return;
    stopped=true;clear(retry);clear(watch);clear(check);retry=watch=check=null;
    auth?.abort();auth=null;const old=socket;socket=null;token='';
    if(old){try{old.close();}catch{}}
    if(notify)adapter.stop();
  }
  function fail(ws){
    if(stopped||socket!==ws)return;
    socket=null;phase='idle';clear(watch);clear(check);watch=check=null;auth?.abort();auth=null;
    try{ws.close();}catch{}
    adapter.disconnected();
    const delay=Math.min(30000,1000*2**Math.min(attempt++,5));
    retry=schedule(()=>{retry=null;connect();},delay);
  }
  function watchdog(ws){
    clear(watch);watch=schedule(()=>fail(ws),90000);
  }
  function send(ws,event,data){
    if(socket!==ws||stopped)return false;
    try{ws.send(JSON.stringify({event,data}));return true;}catch{fail(ws);return false;}
  }
  function periodic(ws){
    clear(check);
    check=schedule(async()=>{
      if(stopped||socket!==ws)return;
      await adapter.refresh();
      if(!stopped&&socket===ws)periodic(ws);
    },30000);
  }
  async function message(ws,raw){
    if(stopped||socket!==ws)return;
    let frame;
    try{if(typeof raw!=='string'||raw.length>10000)throw Error();frame=JSON.parse(raw);}catch{fail(ws);return;}
    if(!frame||typeof frame.event!=='string'){fail(ws);return;}
    if(phase==='subscribed')watchdog(ws);
    if(frame.event==='pusher:ping'){send(ws,'pusher:pong',{});return;}
    if(frame.event==='pusher:error'){fail(ws);return;}
    if(frame.event==='pusher:connection_established'&&phase==='handshake'){
      let sid;
      try{sid=(typeof frame.data==='string'?JSON.parse(frame.data):frame.data).socket_id;}catch{fail(ws);return;}
      if(typeof sid!=='string'||!/^[0-9]{1,20}\.[0-9]{1,20}$/.test(sid)){fail(ws);return;}
      phase='authorizing';auth=new AbortController();
      try{
        const res=await fetcher('/api/v1/realtime/auth',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+token},
          body:JSON.stringify({socket_id:sid,channel_name:adapter.channel}),cache:'no-store',credentials:'omit',redirect:'error',
          referrerPolicy:'no-referrer',signal:AbortSignal.any([auth.signal,AbortSignal.timeout(8000)])});
        if(stopped||socket!==ws)return;
        if([401,403,404].includes(res.status)){
          shutdown();onState({state:'unauthorized',online:false,data:null});return;
        }
        if(!res.ok){fail(ws);return;}
        const result=await res.json();
        if(stopped||socket!==ws)return;
        if(typeof result?.auth!=='string'||!result.auth.startsWith(key+':')||! /^[0-9a-f]{64}$/.test(result.auth.slice(key.length+1))){fail(ws);return;}
        phase='subscribing';send(ws,'pusher:subscribe',{channel:adapter.channel,auth:result.auth});
      }catch{fail(ws);}
      return;
    }
    if(frame.event==='pusher_internal:subscription_succeeded'&&phase==='subscribing'&&frame.channel===adapter.channel){
      phase='subscribed';attempt=0;watchdog(ws);periodic(ws);await adapter.connected();return;
    }
    if(frame.event==='pusher_internal:subscription_error'){fail(ws);return;}
    if(phase==='subscribed')await adapter.receive(frame);
  }
  function connect(){
    if(stopped||socket)return;
    let ws;
    try{ws=socketFactory(url.href);}catch{
      retry=schedule(()=>{retry=null;connect();},Math.min(30000,1000*2**Math.min(attempt++,5)));return;
    }
    socket=ws;phase='handshake';watch=schedule(()=>fail(ws),12000);
    ws.onmessage=e=>{void message(ws,e.data);};
    ws.onclose=()=>fail(ws);ws.onerror=()=>fail(ws);
  }
  return {start(){if(started||stopped)return;started=true;connect();},stop:shutdown,refresh:adapter.refresh};
}
