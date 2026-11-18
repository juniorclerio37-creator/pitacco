import React,{useEffect,useState} from 'react';
import CourierRemunerationFields,{emptyRemuneration,normalizeRemuneration,
  remunerationLabel,validateRemuneration} from './CourierRemunerationFields.jsx';

export default function CourierRates({client,storeId}){
 const [couriers,setCouriers]=useState([]),[rules,setRules]=useState([]);
 const [who,setWho]=useState(''),[form,setForm]=useState({...emptyRemuneration});
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const load=async()=>{
  const [a,b]=await Promise.all([
   client.from('couriers').select('id,name').eq('store_id',storeId),
   client.from('pitacco_courier_pay_rules').select('*').eq('store_id',storeId)
  ]);
  if(a.error)throw a.error;if(b.error)throw b.error;
  setCouriers(a.data||[]);setRules(b.data||[]);
 };
 useEffect(()=>{if(storeId)load().catch(e=>setMessage(e.message))},[client,storeId]);
 useEffect(()=>{setForm({...emptyRemuneration,...rules.find(r=>r.courier_id===who)})},[who,rules]);
 async function save(event){
  event.preventDefault();setMessage('');
  if(!who){setMessage('Selecione um entregador.');return;}
  const problem=validateRemuneration(form);
  if(problem){setMessage(problem);return;}
  setBusy(true);
  try{
   const rule=normalizeRemuneration(form);
   const {error}=await client.from('pitacco_courier_pay_rules')
    .upsert({store_id:storeId,courier_id:who,...rule},
      {onConflict:'store_id,courier_id'});
   if(error)throw error;
   await load();
   setMessage('Remuneração salva. Entregas já concluídas permanecem com o valor registrado.');
  }catch(e){setMessage(e.message)}finally{setBusy(false);}
 }
 return <section className="panel">
  <h3>Regras de remuneração dos motoboys</h3>
  <p>Defina a remuneração no cadastro ou ajuste aqui. O Pitacco aplica a regra às próximas entregas concluídas.</p>
  {message&&<p role="status">{message}</p>}
  <form onSubmit={save}>
   <label className="field">Entregador
    <select required value={who} onChange={event=>setWho(event.target.value)}>
     <option value="">Selecione</option>
     {couriers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
   </label>
   {who&&<>
    <CourierRemunerationFields value={form} onChange={setForm} disabled={busy}/>
    <p className="hint">Regra: {remunerationLabel(form)}. Frete promocional grátis não reduz o valor original do frete usado para pagar o entregador.</p>
    <button type="submit" disabled={busy}>Salvar remuneração</button>
   </>}
  </form>
 </section>;
}
