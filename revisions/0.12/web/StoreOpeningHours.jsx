import React,{useEffect,useState} from 'react';
import './store-opening-hours.css';

const days=['Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado','Domingo'];
const format=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
const choices=Array.from({length:97},(_,i)=>i*15);
const displayTime=m=>m===1440?'24:00':format(m);
const nextTime=value=>value?new Date(value).toLocaleString('pt-BR',{
  weekday:'long',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',
  timeZone:'America/Sao_Paulo'
}):null;
const normalize=rows=>rows.flatMap((row,i)=>row.map((p,j)=>({
 weekday:i+1,slot:j+1,opens_minute:Number(p.opens_minute),closes_minute:Number(p.closes_minute)
})));
const defaultPeriod=()=>({opens_minute:600,closes_minute:1320});

export default function StoreOpeningHours({client,store,manager=true}){
 const [rows,setRows]=useState(Array.from({length:7},()=>[]));
 const [paused,setPaused]=useState(false),[legacy,setLegacy]=useState(false),[revision,setRevision]=useState(0);
 const [current,setCurrent]=useState(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[reload,setReload]=useState(0);
 const [loaded,setLoaded]=useState(false);
 useEffect(()=>{
  let alive=true;
  setLoading(true);setLoaded(false);setNotice('');setError('');
  client.rpc('pitacco_store_hours_state',{p_store:store.id}).then(({data,error})=>{
   if(error)throw error;
   if(!alive)return;
   const organized=Array.from({length:7},()=>[]);
   for(const p of data.periods||[])if(p.weekday>=1&&p.weekday<=7)
    organized[p.weekday-1].push({opens_minute:p.opens_minute,closes_minute:p.closes_minute});
   setRows(organized);setPaused(!!data.paused);setLegacy(!data.manager_configured);
   setRevision(data.revision);setCurrent(data.current);setLoaded(true);
  }).catch(e=>{if(alive)setError(e.message||'Não foi possível carregar os horários da loja.')})
   .finally(()=>{if(alive)setLoading(false)});
  return()=>{alive=false};
 },[client,store.id,reload]);
 function editDay(day,updated){
  setRows(all=>all.map((list,index)=>index===day?updated:list));
  setError('');setNotice('');
 }
 function editWindow(day,slot,key,value){
  editDay(day,rows[day].map((period,index)=>index===slot?{...period,[key]:Number(value)}:period));
 }
 function cloneWorkdays(){
  setRows(prev=>prev.map((item,index)=>index>=1&&index<=4
   ?prev[0].map(p=>({...p})):item));
  setNotice('Horários da segunda copiados para terça a sexta. Salve para aplicar.');
 }
 async function save(nextPaused=paused){
  if(!manager||busy)return;
  setError('');setNotice('');
  const periods=normalize(rows);
  if(periods.some(p=>p.opens_minute===p.closes_minute)){
   setError('A abertura e o fechamento não podem ser iguais. Para 24 horas, use 00:00 até 24:00.');
   return;
  }
  setBusy(true);
  try{
   const {data,error}=await client.rpc('pitacco_store_hours_save',{
    p_store:store.id,p_periods:periods,p_paused:nextPaused,p_expected_revision:revision
   });
   if(error)throw error;
   if(!data?.saved)throw Error('O servidor não confirmou os horários.');
   setPaused(nextPaused);setRevision(data.revision);setCurrent(data.current);setLegacy(!data.current?.manager_configured);
   setNotice(nextPaused?'Pedidos pausados. O cardápio continuará visível, mas não aceitará novos pedidos.':
    'Horários salvos! O cardápio agora recebe pedidos somente nos intervalos definidos.');
  }catch(e){setError(e.message||'Não foi possível salvar os horários.');}
  finally{setBusy(false)}
 }
 const open=current?.open===true;
 return <section className="opening-settings" aria-label="Horário de funcionamento da loja">
  <div className="opening-top">
   <div><span className="eyebrow">ADMINISTRAR LOJA · FUNCIONAMENTO</span>
    <h3>Horário de funcionamento</h3>
    <p>Defina quando seus clientes podem fazer pedidos pelo cardápio digital. O fechamento é automático, pelo horário de Brasília.</p>
   </div>
   <span className={'opening-state '+(open?'open':'closed')}>
    {loading?'Verificando…':open?'● Aberta para pedidos':paused?'● Recebimento pausado':'● Fechada para pedidos'}
   </span>
  </div>
  {error&&<p role="alert" className="notice error">{error}</p>}
  {notice&&<p role="status" className="notice">{notice}</p>}
  {loading&&<p role="status">Carregando horário de funcionamento…</p>}
  {!loading&&!loaded&&<button type="button" onClick={()=>setReload(v=>v+1)}>Tentar novamente</button>}
  {loaded&&<>
   {legacy&&<div className="opening-legacy" role="note">
    <strong>Horário inicial configurado para preservar suas vendas.</strong>
    <p>O funcionamento anterior foi mantido em 24 horas por dia. Ajuste os dias e horários abaixo para que a loja feche automaticamente.</p>
   </div>}
   <div className="opening-pause">
    <div><strong>Pausar o recebimento de pedidos</strong>
     <p>Você pode fechar temporariamente sem perder o horário semanal. Os pedidos existentes continuam disponíveis.</p>
     {current?.next_open_at&&!paused&&!open&&<small>Próxima abertura: {nextTime(current.next_open_at)}.</small>}
    </div>
    <button type="button" disabled={!manager||busy} className={paused?'opening-resume':'opening-pause-button'}
     onClick={()=>save(!paused)}>
     {busy?'Salvando…':paused?'Reabrir conforme os horários':'Pausar pedidos agora'}
    </button>
   </div>
   <div className="opening-hours-head">
    <div><h4>Agenda semanal</h4><p>Até três períodos por dia. Você pode criar turnos de almoço e jantar ou fechar depois da meia-noite.</p></div>
    <button type="button" className="secondary" disabled={busy||!manager} onClick={cloneWorkdays}>Copiar segunda para dias úteis</button>
   </div>
   <div className="opening-days">
    {days.map((name,day)=><div className="opening-day" key={name}>
     <div className="opening-day-meta">
      <label className="opening-day-toggle"><input type="checkbox" checked={rows[day].length>0}
        disabled={busy||!manager} onChange={e=>editDay(day,e.target.checked?[defaultPeriod()]:[])}/>
       <strong>{name}</strong></label>
      <span>{rows[day].length?'Recebendo pedidos nos períodos definidos':'Fechado'}</span>
     </div>
     {rows[day].length>0&&<div className="opening-windows">
      {rows[day].map((p,i)=><div className="opening-window" key={i}>
       <label>Abre
        <select value={p.opens_minute} disabled={busy||!manager}
         onChange={e=>editWindow(day,i,'opens_minute',e.target.value)}>
         {choices.slice(0,-1).map(min=><option key={min} value={min}>{displayTime(min)}</option>)}
        </select>
       </label>
       <span className="opening-connector">até</span>
       <label>Fecha
        <select value={p.closes_minute} disabled={busy||!manager}
         onChange={e=>editWindow(day,i,'closes_minute',e.target.value)}>
         {choices.map(min=><option key={min} value={min}>{displayTime(min)}</option>)}
        </select>
       </label>
       {p.closes_minute<p.opens_minute&&<span className="opening-overnight">Dia seguinte</span>}
       <button type="button" className="secondary opening-remove" disabled={busy||!manager}
        aria-label={'Remover período '+(i+1)+' de '+name} onClick={()=>editDay(day,rows[day].filter((_,j)=>j!==i))}>Remover</button>
      </div>)}
      {rows[day].length<3&&<button className="secondary opening-add" disabled={busy||!manager} type="button"
       onClick={()=>editDay(day,[...rows[day],defaultPeriod()])}>+ Adicionar outro período</button>}
     </div>}
    </div>)}
   </div>
   <div className="opening-save">
    <p>O cardápio fica visível quando a loja fecha, mas não permite novos pedidos. A regra é aplicada diretamente pelo servidor, inclusive para pedidos agendados.</p>
    <button type="button" disabled={busy||!manager} onClick={()=>save()}>{busy?'Salvando…':'Salvar horário de funcionamento'}</button>
   </div>
  </>}
 </section>;
}
