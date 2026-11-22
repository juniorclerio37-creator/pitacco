import React,{useCallback,useEffect,useRef,useState} from 'react';
const money=cents=>(Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const defaults={points_enabled:false,points_per_real:1,min_points_to_redeem:100,points_reward_cents:1000,orders_enabled:false,orders_required:10,orders_reward_cents:1000,coupons_enabled:true,campaigns_enabled:false,cashback_enabled:false,cashback_percent:0,cashback_max_redeem_percent:50,referrals_enabled:false,referral_reward_cents:0,referral_welcome_cents:0,minimum_order_cents:0};
const tabs=['Visão geral','Clientes e pontos','Cupons','Campanhas','Cashback','Indique e ganhe'];
const sections=[['points_enabled','Pontos'],['orders_enabled','Recompensa por pedidos'],['coupons_enabled','Cupons'],['campaigns_enabled','Campanhas'],['cashback_enabled','Cashback'],['referrals_enabled','Indicações']];
const dateValue=value=>value?new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date(value)):'';
export default function Fideliza({client,storeId,manager}){
 const [section,setSection]=useState('Visão geral'),[program,setProgram]=useState(defaults),[coupons,setCoupons]=useState([]),[customers,setCustomers]=useState([]);
 const [ready,setReady]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[editing,setEditing]=useState(null),[recovered,setRecovered]=useState(null);
 const version=useRef(0);
 const refresh=useCallback(async()=>{
  if(!storeId||!manager)return;
  const request=++version.current;setLoading(true);setError('');
  try{
   const [p,c,people]=await Promise.all([
    client.from('loyalty_programs').select('*').eq('store_id',storeId).maybeSingle(),
    client.from('loyalty_coupons').select('*').eq('store_id',storeId).neq('kind','reward').order('created_at',{ascending:false}),
    client.rpc('pitacco_loyalty_customers',{p_store:storeId})]);
   if(p.error)throw p.error;if(c.error)throw c.error;if(people.error)throw people.error;
   if(request!==version.current)return;
   setReady(true);setProgram({...defaults,...p.data});setCoupons(c.data||[]);setCustomers(people.data||[]);
  }catch(e){if(request===version.current)setError(e.message||String(e))}finally{if(request===version.current)setLoading(false)}
 },[client,storeId,manager]);
 useEffect(()=>{setReady(false);setProgram(defaults);setMessage('');setEditing(null);setRecovered(null);setCoupons([]);setCustomers([]);void refresh();return()=>{version.current++}},[refresh]);
 const update=(key,value)=>setProgram(old=>({...old,[key]:value}));
 async function saveProgram(e){
  e.preventDefault();if(loading)return;setLoading(true);setError('');setMessage('');
  try{
   const data={store_id:storeId,updated_at:new Date().toISOString()};
   for(const key of Object.keys(defaults))data[key]=typeof defaults[key]==='boolean'?!!program[key]:Number(program[key]);
   if(data.cashback_enabled&&data.cashback_percent<=0)throw Error('Informe o percentual de cashback antes de ativar.');
   if(data.referrals_enabled&&data.referral_reward_cents+data.referral_welcome_cents<=0)throw Error('Configure o crédito da indicação antes de ativar.');
   const {error}=await client.from('loyalty_programs').upsert(data,{onConflict:'store_id'});if(error)throw error;
   setMessage('Regras salvas e disponíveis no cardápio. Novos pedidos usarão estas regras.');
  }catch(e){setError(e.message||String(e))}finally{setLoading(false)}
 }
 async function saveCoupon(e){
  e.preventDefault();if(loading)return;const form=e.currentTarget,f=new FormData(form);setLoading(true);setError('');setMessage('');
  try{
   const code=String(f.get('code')||editing?.code||'').trim().toUpperCase(),type=String(f.get('discount_type')),amount=Number(f.get('discount_value'));
   if(!/^[A-Z0-9_-]{3,32}$/.test(code))throw Error('Código: 3 a 32 caracteres, letras, números, _ ou -.');
   if(!Number.isFinite(amount)||amount<=0||(type==='percent'&&amount>100))throw Error('Valor do desconto inválido.');
   const row={store_id:storeId,kind:section==='Campanhas'?'campaign':'coupon',title:String(f.get('title')||'').trim(),discount_type:type,discount_value:Math.round(amount*100)/100,
    minimum_order_cents:Math.round(Number(f.get('minimum_order')||0)*100),max_uses:f.get('max_uses')?Number(f.get('max_uses')):null,
    per_customer_limit:f.get('per_customer_limit')?Number(f.get('per_customer_limit')):null,target_customer_id:f.get('target_customer_id')||null,
    starts_at:f.get('starts_at')?new Date(String(f.get('starts_at'))+'T00:00:00-03:00').toISOString():null,
    expires_at:f.get('expires_at')?new Date(String(f.get('expires_at'))+'T23:59:59-03:00').toISOString():null};
   if(row.starts_at&&row.expires_at&&row.expires_at<=row.starts_at)throw Error('O fim deve ser posterior ao início.');
   const result=editing?await client.from('loyalty_coupons').update(row).eq('id',editing.id).eq('store_id',storeId):await client.from('loyalty_coupons').insert({...row,code});
   if(result.error)throw result.error;
   form.reset();setEditing(null);setMessage('Oferta salva. Quando a modalidade estiver ativa, poderá ser usada no cardápio.');await refresh();
  }catch(e){setError(e.message||String(e))}finally{setLoading(false)}
 }
 async function toggleCoupon(c){
  if(loading)return;setLoading(true);setError('');
  try{const {error}=await client.from('loyalty_coupons').update({active:!c.active}).eq('id',c.id).eq('store_id',storeId);if(error)throw error;await refresh()}catch(e){setError(e.message||String(e))}finally{setLoading(false)}
 }
 async function deleteCoupon(c){
  if(loading||!window.confirm('Excluir o cupom '+c.code+'? Cupons com histórico devem ser desativados.'))return;
  setLoading(true);setError('');
  try{
   const {count,error}=await client.from('loyalty_coupon_redemptions').select('id',{count:'exact',head:true}).eq('store_id',storeId).eq('coupon_id',c.id);
   if(error)throw error;if(count||Number(c.uses)>0)throw Error('Oferta com histórico: use Desativar para preservar os registros.');
   const result=await client.from('loyalty_coupons').delete().eq('id',c.id).eq('store_id',storeId).eq('uses',0);if(result.error)throw result.error;
   setMessage('Oferta excluída.');await refresh();
  }catch(e){setError(e.message||String(e))}finally{setLoading(false)}
 }
 async function resetKey(c){
  if(loading||!window.confirm('Confirme a identidade de '+c.name+' antes de recuperar o acesso. A chave anterior deixará de funcionar.'))return;
  setLoading(true);setError('');setRecovered(null);
  try{const {data,error}=await client.rpc('pitacco_loyalty_reset_key',{p_store:storeId,p_customer:c.id});if(error)throw error;setRecovered({name:c.name,key:data})}catch(e){setError(e.message||String(e))}finally{setLoading(false)}
 }
 const toggle=(key,label)=><label className="toggle"><input type="checkbox" checked={!!program[key]} onChange={e=>update(key,e.target.checked)}/>{label}</label>;
 const number=(key,label,min,max,step=1)=><label className="field">{label}<input type="number" min={min} max={max} step={step} required value={program[key]} onChange={e=>update(key,e.target.value)}/></label>;
 const sectionKind=section==='Campanhas'?'campaign':'coupon';
 if(!manager)return <section className="panel"><h2>Fideliza+</h2><p>Somente gestores podem administrar os benefícios da loja.</p></section>;
 return <section aria-label="Fideliza+" className="loyalty-page" aria-busy={loading}>
  <header><h2>Fideliza+</h2><p>Escolha as modalidades da sua loja. O cliente consulta e resgata os benefícios diretamente no cardápio.</p></header>
  <div className="quick-actions" role="tablist" aria-label="Seções do Fideliza+">{tabs.map(t=><button type="button" key={t} role="tab" aria-selected={section===t} className={section===t?'':'secondary'} onClick={()=>{setSection(t);setEditing(null);setRecovered(null)}}>{t}</button>)}</div>
  {error&&<p role="alert" className="notice error">{error}</p>}{message&&<p role="status" className="notice">{message}</p>}
  <p className="hint">Créditos são liberados após entrega e pagamento confirmados, sobre os produtos após descontos, sem frete. Cancelamentos revertem os lançamentos. Resgates são descontos, não saque em dinheiro. A loja preserva o controle de quais modalidades ativar.</p>
  {section==='Visão geral'&&<form className="panel" onSubmit={saveProgram}><h3>Modalidades da loja</h3>{sections.map(([key,label])=><React.Fragment key={key}>{toggle(key,label)}</React.Fragment>)}
   {number('minimum_order_cents','Valor mínimo dos produtos para acumular (centavos)',0,1000000)}<p className="hint">Configure os valores de cashback e indicações nas respectivas abas antes de ativá-los. As regras valem para pedidos novos.</p><button disabled={loading||!ready}>Salvar modalidades</button></form>}
  {section==='Clientes e pontos'&&<><form className="panel" onSubmit={saveProgram}><h3>Pontos e recompensa por pedidos</h3>
   {toggle('points_enabled','Ativar pontos')}{number('points_per_real','Pontos por R$ 1 em produtos',0,1000,.01)}
   {number('min_points_to_redeem','Pontos necessários para um resgate',1,10000000)}{number('points_reward_cents','Desconto do resgate (centavos)',1,1000000)}
   {toggle('orders_enabled','Ativar recompensa por quantidade de pedidos')}{number('orders_required','Pedidos para um resgate',1,1000)}{number('orders_reward_cents','Desconto da recompensa por pedidos (centavos)',1,1000000)}
   <p className="hint">Um pedido pago e entregue acumula uma participação. O resgate desconta a quantidade configurada; o saldo restante é preservado.</p><button disabled={loading||!ready}>Salvar regras de pontos</button></form>
   <div className="panel"><h3>Clientes e carteiras</h3>{!customers.length&&<p>Os clientes aparecerão após aderirem ao Fideliza+ pelo cardápio.</p>}{customers.map(c=><div className="line" key={c.id}><b>{c.name}</b><span>{c.phone} · {c.points} pontos · {c.orders} pedidos · Créditos {money(c.cashback_cents)}</span><button className="secondary" disabled={loading||!ready} onClick={()=>resetKey(c)}>Recuperar acesso</button></div>)}
   {recovered&&<div role="status"><p>Nova chave de {recovered.name}. Entregue somente ao cliente após conferir a identidade.</p><input aria-label="Nova chave pessoal" readOnly value={recovered.key} onFocus={e=>e.target.select()}/><button type="button" onClick={()=>setRecovered(null)}>Ocultar chave</button></div>}</div></>}
  {['Cupons','Campanhas'].includes(section)&&<>
   <form className="panel" onSubmit={saveProgram}>{toggle(section==='Campanhas'?'campaigns_enabled':'coupons_enabled','Ativar '+section.toLowerCase()+' no cardápio')}<button disabled={loading||!ready}>Salvar ativação</button></form>
   <form className="panel" key={editing?.id||section} onSubmit={saveCoupon}><h3>{editing?'Editar oferta':section==='Campanhas'?'Criar campanha':'Criar cupom'}</h3>
    <label className="field">Nome da oferta<input name="title" maxLength={120} required={section==='Campanhas'} defaultValue={editing?.title||''}/></label>
    <label className="field">Código<input name="code" maxLength={32} required disabled={!!editing} defaultValue={editing?.code||''} placeholder="VOLTE10"/></label>
    <label className="field">Tipo<select name="discount_type" defaultValue={editing?.discount_type||'percent'}><option value="percent">Porcentagem (%)</option><option value="fixed">Valor fixo (R$)</option></select></label>
    <label className="field">Desconto<input name="discount_value" type="number" step="0.01" min="0.01" required defaultValue={editing?.discount_value||''}/></label>
    <label className="field">Pedido mínimo em produtos (R$)<input name="minimum_order" type="number" step="0.01" min="0" defaultValue={(editing?.minimum_order_cents||0)/100}/></label>
    <label className="field">Limite total de utilizações<input name="max_uses" type="number" min="1" defaultValue={editing?.max_uses||''}/></label>
    <label className="field">Limite por cliente (exige acesso à carteira)<input name="per_customer_limit" type="number" min="1" max="10000" defaultValue={editing?.per_customer_limit||''}/></label>
    <label className="field">Cliente exclusivo<select name="target_customer_id" defaultValue={editing?.target_customer_id||''}><option value="">Todos os clientes</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}</select></label>
    <label className="field">Início (Brasília)<input name="starts_at" type="date" defaultValue={dateValue(editing?.starts_at)}/></label>
    <label className="field">Fim (Brasília)<input name="expires_at" type="date" defaultValue={dateValue(editing?.expires_at)}/></label>
    <p className="hint">Campanhas vigentes aparecem no cardápio com código, desconto e condições. Um pedido usa um cupom ou um resgate; não há acúmulo de descontos.</p>
    <button disabled={loading||!ready}>{editing?'Salvar alterações':'Cadastrar oferta'}</button>{editing&&<button type="button" className="secondary" onClick={()=>setEditing(null)}>Cancelar edição</button>}
   </form>
   <div className="panel"><h3>Ofertas cadastradas</h3>{coupons.filter(c=>c.kind===sectionKind).map(c=><div className="line" key={c.id}><b>{c.title||c.code} · {c.code}</b><span>{c.discount_type==='percent'?c.discount_value+'%':money(c.discount_value*100)} · {c.uses} uso(s){c.max_uses?'/'+c.max_uses:''}{c.active?' · Ativa':' · Desativada'}</span><button className="secondary" disabled={loading||!ready} onClick={()=>setEditing(c)}>Editar</button><button className="secondary" disabled={loading||!ready} onClick={()=>toggleCoupon(c)}>{c.active?'Desativar':'Ativar'}</button><button className="secondary" disabled={loading||Number(c.uses)>0} onClick={()=>deleteCoupon(c)}>Excluir</button></div>)}{!coupons.some(c=>c.kind===sectionKind)&&<p>Nenhuma oferta cadastrada nesta modalidade.</p>}</div>
  </>}
  {section==='Cashback'&&<form className="panel" onSubmit={saveProgram}><h3>Cashback em compras</h3>{toggle('cashback_enabled','Ativar cashback')}
   {number('cashback_percent','Percentual sobre produtos pagos, após descontos (%)',0,50,.01)}{number('cashback_max_redeem_percent','Percentual máximo dos produtos que os créditos podem pagar (%)',1,100,.01)}
   <p>Exemplo: R$ 100 em produtos com 5% de cashback geram R$ 5 após pagamento e entrega. Créditos ficam na carteira desta loja e podem ser usados em outra compra.</p><button disabled={loading||!ready}>Salvar cashback</button></form>}
  {section==='Indique e ganhe'&&<form className="panel" onSubmit={saveProgram}><h3>Indique e ganhe</h3>{toggle('referrals_enabled','Ativar indicações')}
   {number('referral_reward_cents','Crédito para quem indica (centavos)',0,100000)}{number('referral_welcome_cents','Crédito para o novo cliente (centavos)',0,100000)}
   <p>O cliente compartilha seu código pessoal. A indicação deve ser informada no cadastro de um novo participante. Os créditos são liberados uma vez, na primeira compra paga e entregue que alcançar o mínimo da loja. Autoindicação pelo mesmo telefone é recusada.</p><button disabled={loading||!ready}>Salvar indicações</button></form>}
 </section>;
}
