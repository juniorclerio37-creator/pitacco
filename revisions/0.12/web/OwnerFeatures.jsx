import React,{useEffect,useState} from 'react';
import {featureLabels} from './storeFeatures.mjs';

export default function OwnerFeatures({client,stores}){
 const [store,setStore]=useState(''),[settings,setSettings]=useState(null),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{
  let current=true;
  setSettings(null);setError('');setNotice('');
  client.rpc('pitacco_owner_feature_settings',{p_store:store||null}).then(({data,error})=>{
   if(!current)return;
   if(error)setError(error.message);else setSettings(data);
  }).catch(failure=>{if(current)setError(failure.message);});
  return()=>{current=false;};
 },[client,store]);

 async function save(feature,value){
  setBusy(true);setError('');setNotice('');
  const enabled=value==='default'?null:value==='enabled';
  try{
   const {error}=await client.rpc('pitacco_owner_set_feature',{p_store:store||null,p_feature:feature,p_enabled:enabled});
   if(error)throw error;
   const result=await client.rpc('pitacco_owner_feature_settings',{p_store:store||null});
   if(result.error)throw result.error;
   setSettings(result.data);
   setNotice(featureLabels[feature]+' atualizado.');
  }catch(failure){setError(failure.message||'Não foi possível salvar o módulo.');}
  finally{setBusy(false);}
 }

 return <section className="panel" aria-label="Módulos do painel do lojista">
  <h3>Módulos do painel do lojista</h3>
  <label htmlFor="feature-store">Aplicar a</label>
  <select id="feature-store" value={store} disabled={busy} onChange={event=>setStore(event.target.value)}>
   <option value="">Padrão de todas as lojas</option>
   {stores.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
  </select>
  <p>Uma configuração da loja tem prioridade sobre o padrão geral. Ocultar um módulo preserva seus registros.</p>
  {error&&<p role="alert">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  {!settings&&!error&&<p role="status">Carregando módulos…</p>}
  {settings&&<div className="store-grid">
   {Object.entries(featureLabels).map(([feature,label])=>{
    const rule=settings[feature];
    const selected=store?(rule.override==null?'default':rule.override?'enabled':'disabled'):(rule.default_enabled?'enabled':'disabled');
    return <div className="panel" key={feature}>
     <label htmlFor={'module-'+feature}>{label}</label>
     <select id={'module-'+feature} disabled={busy} value={selected} onChange={event=>save(feature,event.target.value)}>
      {store&&<option value="default">Seguir padrão geral ({rule.default_enabled?'ativado':'desativado'})</option>}
      <option value="enabled">Ativado</option><option value="disabled">Desativado</option>
     </select>
    </div>;
   })}
  </div>}
 </section>;
}
