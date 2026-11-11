import React,{useEffect,useState} from 'react';
const zero={mode:'per_delivery',rate:0,daily_rate:0,km_rate:0,per_delivery_rate:0,include_customer_fee:false};
export default function CourierRates({client,storeId}){
 const [couriers,setCouriers]=useState([]),[rules,setRules]=useState([]),[who,setWho]=useState(''),[form,setForm]=useState(zero),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const load=async()=>{const [a,b]=await Promise.all([client.from('couriers').select('id,name').eq('store_id',storeId),client.from('pitacco_courier_pay_rules').select('*').eq('store_id',storeId)]);if(a.error)throw a.error;if(b.error)throw b.error;setCouriers(a.data||[]);setRules(b.data||[])};
 useEffect(()=>{if(storeId)load().catch(e=>setMessage(e.message))},[client,storeId]);
 useEffect(()=>{setForm({...zero,...rules.find(r=>r.courier_id===who)})},[who,rules]);
 const update=(k,v)=>setForm(f=>({...f,[k]:v}));
 async function save(e){e.preventDefault();setBusy(true);setMessage('');try{
 if(!who)throw Error('Selecione um entregador cadastrado');
 const values={store_id:storeId,courier_id:who,mode:form.mode,rate:Number(form.rate||0),daily_rate:Number(form.daily_rate||0),km_rate:Number(form.km_rate||0),per_delivery_rate:Number(form.per_delivery_rate||0),include_customer_fee:!!form.include_customer_fee};
 if(['rate','daily_rate','km_rate','per_delivery_rate'].some(k=>!Number.isFinite(values[k])||values[k]<0))throw Error('Informe valores válidos e não negativos');
 const {error}=await client.from('pitacco_courier_pay_rules').upsert(values,{onConflict:'store_id,courier_id'});if(error)throw error;
 await load();setMessage('Regra salva no banco. Entregas concluídas não serão recalculadas.');
 }catch(e){setMessage(e.message)}finally{setBusy(false)}}
 return <section className="panel"><h3>Regras de pagamento dos motoboys</h3><p>Regras individuais registradas no banco real do Pitacco.</p>{message&&<p role="status">{message}</p>}<form onSubmit={save}><label className="field">Entregador<select required value={who} onChange={e=>setWho(e.target.value)}><option value="">Selecione</option>{couriers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="field">Modelo<select value={form.mode} onChange={e=>update('mode',e.target.value)}><option value="per_delivery">Por entrega</option><option value="per_km">Por quilômetro</option><option value="daily">Diária</option><option value="mixed">Misto</option></select></label>{[['rate','Taxa base'],['per_delivery_rate','Valor por entrega'],['km_rate','Valor por km'],['daily_rate','Diária']].map(([key,label])=><label className="field" key={key}>{label}<input type="number" min="0" step="0.01" value={form[key]} onChange={e=>update(key,e.target.value)}/></label>)}<label><input type="checkbox" checked={!!form.include_customer_fee} onChange={e=>update('include_customer_fee',e.target.checked)}/> Incluir taxa de entrega paga pelo cliente, conforme regra</label><button disabled={busy} type="submit">Salvar regras</button></form></section>
}