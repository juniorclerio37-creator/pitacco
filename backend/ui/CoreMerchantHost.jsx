// Isolated Core integration host, not the published App or installer.
// The original FleetTracking component and receipt renderer are reused.
// The host must provide an explicit test-native bridge; never autodetect Tauri.
import React,{useEffect,useRef,useState} from 'react';
import {createCoreSession} from './core-clients/core-session.mjs';
import {createMerchantRuntime} from './core-clients/merchant-runtime.mjs';
import FleetTracking from './FleetTracking.jsx';
import Pedidos from './Pedidos.jsx';
import {orderStage} from './orderBoard.mjs';
import './style.css';
import './merchant-reference.css';
const noLegacy=new Proxy({}, {get(){throw Error('Transporte legado desativado neste ensaio.');}});
function ExperimentalBoard({runtime,enableOwnActions=false}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[actionError,setActionError]=useState('');
 const live=useRef(false),mutating=useRef(false);
 async function refresh(){try{const value=await runtime.board.read();if(live.current){setData(value);setError('');}}catch(e){if(live.current){setData(null);setError(e.message||'Pedidos indisponíveis.');}}}
 useEffect(()=>{
  live.current=true;
  void refresh();const timer=setInterval(()=>{if(!mutating.current)void refresh();},30000);
  return()=>{live.current=false;clearInterval(timer);};
 },[runtime]);
 async function action(id,kind,reason){
  if(!enableOwnActions||mutating.current)return false;
  mutating.current=true;setBusy(true);setActionError('');
  let confirmed=false;
  try{await runtime.board.act(id,kind,reason);confirmed=true;}
  catch(e){if(live.current)setActionError(e.message||'Resultado não confirmado.');}
  finally{await refresh();mutating.current=false;if(live.current)setBusy(false);}
  return confirmed;
 }
 if(!data)return <section className="panel" role={error?'alert':'status'}>{error||'Carregando pedidos…'}</section>;
 const byOrder=new Map(data.deliveries.map(d=>[d.order_id,d]));
 return <><p role="status">{enableOwnActions?'Ensaio local: aceite, recusa, preparo e retirada de pedidos próprios. Demais ações desativadas.':'Ensaio de leitura: pedidos próprios e iFood. Ações operacionais desativadas.'}</p><Pedidos key={runtime.store} storeId={runtime.store} orders={data.orders} deliveries={data.deliveries} couriers={data.couriers} stage={o=>orderStage(o,byOrder.get(o.id))} busy={!enableOwnActions||busy} experimentalOwnOnly={true} actionError={actionError} onAccept={id=>action(id,'accept')} onDecision={(id,status,reason)=>status==='rejected'?action(id,'reject',reason):Promise.resolve(false)} onReady={id=>action(id,'ready')} onPickup={id=>action(id,'complete_pickup')} merchantLayout={true} dispatchMode={data.settings.dispatch_mode}/></>;
}
export default function CoreMerchantHost({fetcher=globalThis.fetch,windows=null,enableOwnActions=false}){
 const [snapshot,setSnapshot]=useState({identity:null,selected:null,expires_at:null});
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[runtime,setRuntime]=useState(null);
 const [deviceState,setDeviceState]=useState(null),[started,setStarted]=useState(false);
 const sessionRef=useRef(null);
 if(!sessionRef.current)sessionRef.current=createCoreSession({fetcher,onState:setSnapshot});
 const session=sessionRef.current;
 const live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;session.stop();}},[session]);
 useEffect(()=>{
  setRuntime(null);setStarted(false);setDeviceState(null);
  if(!snapshot.selected||snapshot.selected.role==='courier')return;
  let alive=true;
  try{
   const value=createMerchantRuntime({session,windows:windows?{...windows,onState:s=>{if(alive)setDeviceState(s);}}:null});
   setRuntime(value);
   return()=>{alive=false;value.stop();};
  }catch(e){setMessage(e.message);}
 },[session,snapshot.identity?.id,snapshot.selected?.store_id,snapshot.selected?.role,windows]);
 async function run(action){
  if(busy)return;
  setBusy(true);setMessage('');
  try{await action();}
  catch(e){if(live.current)setMessage(e.message||'Operação indisponível.');}
  finally{if(live.current)setBusy(false);}
 }
 function login(event){
  event.preventDefault();const form=event.currentTarget,data=new FormData(form);
  const email=String(data.get('email')||''),password=String(data.get('password')||'');
  form.reset();void run(()=>session.login(email,password));
 }
 if(!snapshot.identity)return <div className="setup"><img className="auth-logo" src="/pitacco-brand-013.svg" alt="Pitacco"/><h2>Entrar na plataforma</h2><p>Ambiente isolado de integração Core — somente contas de teste.</p><form onSubmit={login}><input type="email" name="email" placeholder="E-mail" required/><input type="password" name="password" placeholder="Senha" required/><button disabled={busy}>Entrar</button></form>{message&&<p role="alert">{message}</p>}</div>;
 const shops=snapshot.identity.stores.filter(s=>s.role!=='courier');
 const chosen=runtime&&runtime.store===snapshot.selected?.store_id?runtime:null;
 return <main className="pitacco-theme-light"><section className="panel"><h3>Ensaio isolado — Pitacco Core</h3><label>Estabelecimento<select value={snapshot.selected?.store_id||''} disabled={busy} onChange={e=>{const id=e.target.value;if(id)void run(()=>session.selectStore(id));}}><option value="" disabled>Selecione a loja</option>{shops.map(s=><option key={s.store_id} value={s.store_id}>{s.name}</option>)}</select></label><div className="quick-actions"><button disabled={busy} onClick={()=>void run(()=>session.refresh())}>Atualizar sessão</button><button disabled={busy} onClick={()=>void run(()=>session.renew())}>Renovar sessão</button><button disabled={busy} onClick={()=>void run(async()=>{const result=await session.logout();if(!result.revoked)setMessage('Sessão local encerrada; revogação remota não confirmada.');})}>Sair</button></div>{message&&<p role="alert">{message}</p>}{chosen?.device&&<div><button disabled={started} onClick={()=>{chosen.device.start();setStarted(true);}}>Iniciar ponte Windows de teste</button><p role="status">{deviceState?.state||'Ponte inativa'}</p></div>}</section>{chosen&&<ExperimentalBoard key={chosen.store} runtime={chosen} enableOwnActions={enableOwnActions}/>}{chosen&&<FleetTracking key={chosen.store} client={noLegacy} storeId={chosen.store} experimentalMap={chosen.map} onBack={()=>{}}/>}</main>;
}
