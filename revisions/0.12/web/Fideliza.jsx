import React,{useCallback,useEffect,useState} from 'react';
const money=cents=>(Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const defaults={points_enabled:false,points_per_real:1,min_points_to_redeem:100,points_reward_cents:1000,orders_enabled:false,orders_required:10,orders_reward_cents:1000};
export default function Fideliza({client,storeId,manager}){
 const [program,setProgram]=useState(defaults),[coupons,setCoupons]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const refresh=useCallback(async()=>{
  if(!storeId||!manager)return;
  setLoading(true);setError('');
  try{
   const [p,c]=await Promise.all([client.from('loyalty_programs').select('*').eq('store_id',storeId).maybeSingle(),client.from('loyalty_coupons').select('*').eq('store_id',storeId).order('created_at',{ascending:false})]);
   if(p.error)throw p.error;if(c.error)throw c.error;
   setProgram({...defaults,...p.data});setCoupons(c.data||[]);
  }catch(e){setError(e.message||String(e))}finally{setLoading(false)}
 },[client,storeId,manager]);
 useEffect(()=>{void refresh()},[refresh]);
 const update=(key,value)=>setProgram(old=>({...old,[key]:value}));
 async function saveProgram(e){
  e.preventDefault();setLoading(true);setError('');setMessage('');
  try{
   const data={store_id:storeId,points_enabled:!!program.points_enabled,points_per_real:Number(program.points_per_real),min_points_to_redeem:Number(program.min_points_to_redeem),points_reward_cents:Number(program.points_reward_cents),orders_enabled:!!program.orders_enabled,orders_required:Number(program.orders_required),orders_reward_cents:Number(program.orders_reward_cents),updated_at:new Date().toISOString()};
   const {error}=await client.from('loyalty_programs').upsert(data,{onConflict:'store_id'});if(error)throw error;
   setMessage('Regras de fidelidade salvas.');
  }catch(e){setError(e.message||String(e))}finally{setLoading(false)}
 }
 async function createCoupon(e){
  e.preventDefault();const form=e.currentTarget,f=new FormData(form);setLoading(true);setError('');setMessage('');
  try{
   const code=String(f.get('code')||'').trim().toUpperCase();
   const discount_type=String(f.get('discount_type'));
   const amount=Number(f.get('discount_value'));
   if(!/^[A-Z0-9_-]{3,32}$/.test(code))throw Error('Código: 3 a 32 caracteres, letras, números, _ ou -.');
   if(!Number.isFinite(amount)||amount<=0||(discount_type==='percent'&&amount>100))throw Error('Valor do desconto inválido.');
   const row={store_id:storeId,code,discount_type,discount_value:discount_type==='fixed'?Math.round(amount*100)/100:amount,minimum_order_cents:Math.round(Number(f.get('minimum_order')||0)*100),max_uses:f.get('max_uses')?Number(f.get('max_uses')):null,expires_at:f.get('expires_at')?new Date(String(f.get('expires_at'))+'T23:59:59').toISOString():null};
   const {error}=await client.from('loyalty_coupons').insert(row);if(error)throw error;
   form.reset();setMessage('Cupom cadastrado. O resgate no checkout ainda requer integração segura.');await refresh();
  }catch(e){setError(e.message||String(e))}finally{setLoading(false)}
 }
 async function toggleCoupon(c){
  setLoading(true);setError('');
  try{const {error}=await client.from('loyalty_coupons').update({active:!c.active}).eq('id',c.id).eq('store_id',storeId);if(error)throw error;await refresh()}catch(e){setError(e.message||String(e))}finally{setLoading(false)}
 }
 if(!manager)return <section className="panel"><h2>Fideliza+</h2><p>Somente gestores podem administrar programas de fidelidade.</p></section>;
 return <section aria-label="Fideliza+" className="loyalty-page">
  <header><h2>Fideliza+</h2><p>Crie regras de pontos, recompensas por pedidos e cupons para os clientes da sua loja.</p></header>
  {error&&<p role="alert" className="notice error">{error}</p>}{message&&<p role="status" className="notice">{message}</p>}
  <form className="panel" onSubmit={saveProgram}><h3>Programa de pontos</h3>
   <label className="toggle"><input type="checkbox" checked={program.points_enabled} onChange={e=>update('points_enabled',e.target.checked)}/>Ativar pontos</label>
   <label className="field">Pontos por R$ 1 gasto<input type="number" min="0" max="1000" step="0.01" required value={program.points_per_real} onChange={e=>update('points_per_real',e.target.value)}/></label>
   <label className="field">Pontos necessários para resgate<input type="number" min="1" required value={program.min_points_to_redeem} onChange={e=>update('min_points_to_redeem',e.target.value)}/></label>
   <label className="field">Valor do benefício (centavos)<input type="number" min="1" required value={program.points_reward_cents} onChange={e=>update('points_reward_cents',e.target.value)}/></label>
   <p className="hint">Exemplo: {program.min_points_to_redeem} pontos dão direito a {money(program.points_reward_cents)} de desconto.</p>
   <h3>Recompensa por quantidade de pedidos</h3>
   <label className="toggle"><input type="checkbox" checked={program.orders_enabled} onChange={e=>update('orders_enabled',e.target.checked)}/>Ativar recompensa por pedidos</label>
   <label className="field">Quantidade de pedidos válidos<input type="number" min="1" max="1000" required value={program.orders_required} onChange={e=>update('orders_required',e.target.value)}/></label>
   <label className="field">Valor do benefício (centavos)<input type="number" min="1" required value={program.orders_reward_cents} onChange={e=>update('orders_reward_cents',e.target.value)}/></label>
   <button disabled={loading}>Salvar regras</button>
  </form>
  <form className="panel" onSubmit={createCoupon}><h3>Criar cupom</h3>
   <label className="field">Código<input name="code" maxLength={32} required placeholder="VOLTE10"/></label>
   <label className="field">Tipo<select name="discount_type"><option value="percent">Porcentagem (%)</option><option value="fixed">Valor fixo (R$)</option></select></label>
   <label className="field">Desconto<input name="discount_value" type="number" step="0.01" min="0.01" required/></label>
   <label className="field">Pedido mínimo (R$)<input name="minimum_order" type="number" step="0.01" min="0" defaultValue="0"/></label>
   <label className="field">Limite de utilizações (opcional)<input name="max_uses" type="number" min="1"/></label>
   <label className="field">Validade (opcional)<input name="expires_at" type="date"/></label>
   <button disabled={loading}>Cadastrar cupom</button>
  </form>
  <div className="panel"><h3>Cupons cadastrados</h3>{coupons.map(c=><div className="line" key={c.id}><b>{c.code}</b><span>{c.discount_type==='percent'?c.discount_value+'%':money(c.discount_value*100)} · {c.uses} uso(s){c.max_uses?'/'+c.max_uses:''}</span><button disabled={loading} className="secondary" onClick={()=>toggleCoupon(c)}>{c.active?'Desativar':'Ativar'}</button></div>)}{!coupons.length&&<p>Nenhum cupom cadastrado.</p>}</div>
  <p className="hint">Os programas e cupons são cadastrados aqui. Pontuação, resgate e aplicação no checkout só devem ser ativados após a validação transacional no backend.</p>
 </section>;
}
