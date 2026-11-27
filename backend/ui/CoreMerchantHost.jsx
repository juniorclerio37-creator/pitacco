// Isolated Core integration host, not the published App or installer.
// The original FleetTracking component and receipt renderer are reused.
// The host must provide an explicit test-native bridge; never autodetect Tauri.
import React,{useEffect,useRef,useState} from 'react';
import {createCoreSession} from './core-clients/core-session.mjs';
import {createMerchantRuntime} from './core-clients/merchant-runtime.mjs';
import FleetTracking from './FleetTracking.jsx';
import './style.css';
import './merchant-reference.css';
const noLegacy=new Proxy({}, {get(){throw Error('Transporte legado desativado neste ensaio.');}});
export default function CoreMerchantHost({fetcher=globalThis.fetch,windows=null}){
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
 return <main className="pitacco-theme-light"><section className="panel"><h3>Ensaio isolado — Pitacco Core</h3><label>Estabelecimento<select value={snapshot.selected?.store_id||''} disabled={busy} onChange={e=>{const id=e.target.value;if(id)void run(()=>session.selectStore(id));}}><option value="" disabled>Selecione a loja</option>{shops.map(s=><option key={s.store_id} value={s.store_id}>{s.name}</option>)}</select></label><div className="quick-actions"><button disabled={busy} onClick={()=>void run(()=>session.refresh())}>Atualizar sessão</button><button disabled={busy} onClick={()=>void run(()=>session.renew())}>Renovar sessão</button><button disabled={busy} onClick={()=>void run(async()=>{const result=await session.logout();if(!result.revoked)setMessage('Sessão local encerrada; revogação remota não confirmada.');})}>Sair</button></div>{message&&<p role="alert">{message}</p>}{chosen?.device&&<div><button disabled={started} onClick={()=>{chosen.device.start();setStarted(true);}}>Iniciar ponte Windows de teste</button><p role="status">{deviceState?.state||'Ponte inativa'}</p></div>}</section>{chosen&&<FleetTracking key={chosen.store} client={noLegacy} storeId={chosen.store} experimentalMap={chosen.map} onBack={()=>{}}/>}</main>;
}
