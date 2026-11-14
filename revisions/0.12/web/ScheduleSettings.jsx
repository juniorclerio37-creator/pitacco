import React,{useEffect,useState} from 'react';

const weekdays=['Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado','Domingo'];
const defaults=weekdays.map((_,index)=>({weekday:index+1,enabled:false,opens_minute:600,closes_minute:1200}));
const formatTime=minute=>minute===1440?'24:00':String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
const times=Array.from({length:49},(_,index)=>index*30);

export default function ScheduleSettings({client,storeId}){
 const [days,setDays]=useState(defaults),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[loaded,setLoaded]=useState(false);
 async function load(isCurrent=()=>true){
  setLoading(true);
  setError('');
  try{
   const result=await client.from('pitacco_schedule_windows').select('weekday,enabled,opens_minute,closes_minute').eq('store_id',storeId);
   if(!isCurrent())return;
   if(result.error)throw result.error;
   const persisted=new Map(result.data.map(row=>[row.weekday,row]));
   setDays(defaults.map(day=>persisted.get(day.weekday)||day));
   setLoaded(true);
  }catch(failure){if(isCurrent())setError(failure.message||'Não foi possível carregar os horários.');}
  finally{if(isCurrent())setLoading(false);}
 }
 useEffect(()=>{
  let current=true;
  load(()=>current);
  return()=>{current=false;};
 },[client,storeId]);
 function update(weekday,field,value){
  setNotice('');
  setDays(rows=>rows.map(row=>row.weekday===weekday?{...row,[field]:value}:row));
 }
 async function save(event){
  event.preventDefault();
  setNotice('');
  setError('');
  if(days.some(day=>day.closes_minute<=day.opens_minute)){
   setError('O horário final deve ser após o inicial.');
   return;
  }
  setBusy(true);
  try{
   const {error}=await client.from('pitacco_schedule_windows').upsert(days.map(day=>({...day,store_id:storeId})),{onConflict:'store_id,weekday'});
   if(error)throw error;
   setNotice('Horários de agendamento salvos.');
  }catch(failure){setError(failure.message||'Não foi possível salvar os horários.');}
  finally{setBusy(false);}
 }
 return <section className="panel" aria-label="Horários de agendamento" aria-busy={loading||busy}>
  <h3>Horários para pedidos agendados</h3>
  <p>As reservas aparecem em intervalos de 30 minutos, com pelo menos uma hora de antecedência e até sete dias à frente. O aceite é liberado 30 minutos antes. Horário de Brasília.</p>
  {loading&&<p role="status">Carregando horários…</p>}
  {error&&<p role="alert">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  {!loaded&&!loading&&<button type="button" onClick={()=>load()}>Tentar carregar novamente</button>}
  {loaded&&<form onSubmit={save}>
   {days.map(day=><fieldset key={day.weekday} disabled={busy}>
    <legend>{weekdays[day.weekday-1]}</legend>
    <label><input type="checkbox" checked={day.enabled} onChange={event=>update(day.weekday,'enabled',event.target.checked)}/> Disponível para agendar</label>
    <label>Das <select value={day.opens_minute} disabled={!day.enabled} onChange={event=>update(day.weekday,'opens_minute',Number(event.target.value))}>
      {times.slice(0,-1).map(time=><option key={time} value={time}>{formatTime(time)}</option>)}
    </select></label>
    <label>Até <select value={day.closes_minute} disabled={!day.enabled} onChange={event=>update(day.weekday,'closes_minute',Number(event.target.value))}>
      {times.slice(1).map(time=><option key={time} value={time}>{formatTime(time)}</option>)}
    </select></label>
   </fieldset>)}
   <button disabled={busy}>{busy?'Salvando…':'Salvar horários'}</button>
  </form>}
 </section>;
}
