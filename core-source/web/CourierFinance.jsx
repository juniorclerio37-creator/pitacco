import React,{useEffect,useState} from 'react';
const money=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const day=d=>new Date(d).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
export default function CourierFinance({client,storeId,view}){
 const [search,setSearch]=useState('');
 const [couriers,setCouriers]=useState([]),[deliveries,setDeliveries]=useState([]),
  [allowances,setAllowances]=useState([]),[payments,setPayments]=useState([]);
 const [selected,setSelected]=useState(''),[period,setPeriod]=useState('dia'),
  [busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState('');
 const refresh=async()=>{
  const [a,b,c,d]=await Promise.all([
   client.rpc('pitacco_store_couriers',{p_store:storeId}),
   client.from('deliveries').select('id,courier_id,status,courier_payment,updated_at')
    .eq('store_id',storeId).eq('status','entregue'),
   client.from('pitacco_courier_payouts')
    .select('id,courier_id,amount,period_start,period_end,created_at,note')
    .eq('store_id',storeId).order('created_at',{ascending:false}),
   client.from('pitacco_courier_daily_allowances')
    .select('courier_id,work_date,amount').eq('store_id',storeId)
  ]);
  for(const result of [a,b,c,d])if(result.error)throw result.error;
  setCouriers(a.data||[]);setDeliveries(b.data||[]);
  setPayments(c.data||[]);setAllowances(d.data||[]);
 };
 useEffect(()=>{
  if(!storeId)return;
  const run=()=>refresh().catch(e=>setError(e.message));
  run();
  const timer=setInterval(run,15000);
  return()=>clearInterval(timer);
 },[client,storeId]);
 const today=day(new Date()),date=new Date(today+'T12:00:00'),start=new Date(date);
 if(period==='semana')start.setDate(date.getDate()-(date.getDay()+6)%7);
 if(period==='mes')start.setDate(1);
 const from=day(start),to=today;
 const forCourier=(id)=>deliveries.filter(d=>d.courier_id===id&&day(d.updated_at)>=from&&day(d.updated_at)<=to);
 const dailyFor=(id)=>allowances.filter(a=>a.courier_id===id&&a.work_date>=from&&a.work_date<=to)
  .reduce((sum,a)=>sum+Number(a.amount||0),0);
 const selectedRows=forCourier(selected);
 const deliveryEarned=selectedRows.reduce((sum,d)=>sum+Number(d.courier_payment||0),0);
 const dailyEarned=dailyFor(selected);
 const earned=deliveryEarned+dailyEarned;
 const paid=payments.filter(p=>p.courier_id===selected&&p.period_start>=from&&p.period_end<=to)
  .reduce((sum,p)=>sum+Number(p.amount||0),0);
 const due=Math.max(0,Math.round((earned-paid)*100)/100);
 async function pay(){
  if(!selected||due<=0||busy)return;
  if(!window.confirm('Registrar pagamento de '+money(due)+' ao entregador?'))return;
  setBusy(true);setError('');
  try{
   const {error}=await client.rpc('pitacco_register_courier_payout',{
    p_store:storeId,p_courier:selected,p_start:from,p_end:to,p_amount:due,p_note:note
   });
   if(error)throw error;
   setNote('');await refresh();
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <div className="panel">
  <h3>{view==='Relatório de motoboys'?'Relatório de entregadores':'Pagamento de entregadores'}</h3><label className="field">Buscar entregador<input aria-label="Buscar entregador" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nome do entregador"/></label>
  <p className="hint">Entregas concluídas + diárias registradas. Cancelamentos valem R$ 0,00. A loja e o motoboy consultam o mesmo repasse.</p>
  {error&&<p role="alert">{error}</p>}
  <label className="field">Período
   <select value={period} onChange={e=>setPeriod(e.target.value)}>
    <option value="dia">Hoje</option><option value="semana">Semana</option><option value="mes">Mês</option>
   </select>
  </label>
  {view==='Relatório de motoboys'?<div style={{overflowX:'auto'}}><table>
   <thead><tr><th>Entregador</th><th>Entregas concluídas</th><th>Por entregas</th><th>Diárias</th><th>Total</th></tr></thead>
   <tbody>{couriers.map(c=>{
    const rows=forCourier(c.id),d=rows.reduce((sum,x)=>sum+Number(x.courier_payment||0),0),a=dailyFor(c.id);
    return <tr key={c.id}><td>{c.name}</td><td>{rows.length}</td><td>{money(d)}</td><td>{money(a)}</td><td>{money(d+a)}</td></tr>;
   })}</tbody>
  </table></div>:<>
   <label className="field">Entregador
    <select value={selected} onChange={e=>setSelected(e.target.value)}>
     <option value="">Selecione</option>
     {couriers.filter(c=>c.name.toLowerCase().includes(search.toLowerCase())).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
   </label>
   {selected&&<>
    <p>Entregas concluídas: <b>{selectedRows.length}</b></p>
    <p>Valor por entregas: <b>{money(deliveryEarned)}</b></p>
    <p>Diárias: <b>{money(dailyEarned)}</b></p>
    <p>Total gerado: <b>{money(earned)}</b></p>
    <p>Já pago: <b>{money(paid)}</b></p>
    <h3>Saldo a pagar: {money(due)}</h3>
    <label className="field">Observação<input value={note} onChange={e=>setNote(e.target.value)}/></label>
    <button type="button" disabled={busy||due<=0} onClick={pay}>
     Registrar pagamento de {money(due)}
    </button>
    <h3>Histórico de pagamentos</h3>
    <table><thead><tr><th>Data</th><th>Período</th><th>Valor</th></tr></thead>
     <tbody>{payments.filter(p=>p.courier_id===selected).map(p=><tr key={p.id}>
      <td>{new Date(p.created_at).toLocaleDateString('pt-BR')}</td>
      <td>{p.period_start} a {p.period_end}</td><td>{money(p.amount)}</td>
     </tr>)}</tbody>
    </table>
   </>}
  </>}
 </div>;
}
