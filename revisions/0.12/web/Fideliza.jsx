import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Users,Gift,Ticket,Megaphone,RefreshCw,UserPlus,Coins,ArrowRight,ExternalLink,ShieldCheck,Smartphone,X,Search} from 'lucide-react';
import './fideliza.css';
const money=cents=>(Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const defaults={points_enabled:false,points_per_real:1,min_points_to_redeem:100,points_reward_cents:1000,orders_enabled:false,orders_required:10,orders_reward_cents:1000,coupons_enabled:true,campaigns_enabled:false,cashback_enabled:false,cashback_percent:0,cashback_max_redeem_percent:50,referrals_enabled:false,referral_reward_cents:0,referral_welcome_cents:0,minimum_order_cents:0};

const dateValue=value=>value?new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date(value)):'';
export default function Fideliza({client,storeId,manager}){
 const [section,setSection]=useState('Visão geral'),[program,setProgram]=useState(defaults),[coupons,setCoupons]=useState([]),[customers,setCustomers]=useState([]);
 const [ready,setReady]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[editing,setEditing]=useState(null),[recovered,setRecovered]=useState(null);
 const version=useRef(0),dialogRef=useRef(null),openerRef=useRef(null);
 const [savedProgram,setSavedProgram]=useState(defaults),[filter,setFilter]=useState('Todos'),[customerQuery,setCustomerQuery]=useState(''),[menuLink,setMenuLink]=useState(''),[used,setUsed]=useState(null),[statsError,setStatsError]=useState(''),[offerDirty,setOfferDirty]=useState(false);
 const refresh=useCallback(async()=>{
  if(!storeId||!manager)return;
  const request=++version.current;setLoading(true);setError('');
  try{
   const [p,c,people,menu,redemptions]=await Promise.all([
    client.from('loyalty_programs').select('*').eq('store_id',storeId).maybeSingle(),
    client.from('loyalty_coupons').select('*').eq('store_id',storeId).neq('kind','reward').order('created_at',{ascending:false}),
    client.rpc('pitacco_loyalty_customers',{p_store:storeId}),
    client.from('public_menu_settings').select('slug,enabled').eq('store_id',storeId).maybeSingle(),
    client.from('loyalty_coupon_redemptions').select('id',{count:'exact',head:true}).eq('store_id',storeId).eq('state','completed')]);
   if(p.error)throw p.error;if(c.error)throw c.error;if(people.error)throw people.error;
   if(request!==version.current)return;
   setReady(true);setProgram({...defaults,...p.data});setSavedProgram({...defaults,...p.data});
   setMenuLink(!menu.error&&menu.data?.enabled&&/^[a-z0-9][a-z0-9-]{2,59}$/.test(menu.data.slug)?'https://pitacco.com.br/'+menu.data.slug:'');
   setUsed(redemptions.error?null:redemptions.count);setStatsError(redemptions.error?'Não foi possível atualizar os benefícios utilizados.':'');setCoupons(c.data||[]);setCustomers(people.data||[]);
  }catch(e){if(request===version.current)setError(e.message||String(e))}finally{if(request===version.current)setLoading(false)}
 },[client,storeId,manager]);
 useEffect(()=>{setSection('Visão geral');setMenuLink('');setUsed(null);setReady(false);setProgram(defaults);setMessage('');setEditing(null);setRecovered(null);setCoupons([]);setCustomers([]);void refresh();return()=>{version.current++}},[refresh]);
 useEffect(()=>{
  if(!storeId||!manager)return;let active=true;
  const timer=setInterval(async()=>{
   if(document.hidden)return;
   try{const [{data,error},counts]=await Promise.all([client.rpc('pitacco_loyalty_customers',{p_store:storeId}),client.from('loyalty_coupon_redemptions').select('id',{count:'exact',head:true}).eq('store_id',storeId).eq('state','completed')]);
    if(active&&!error)setCustomers(data||[]);if(active&&!counts.error)setUsed(counts.count);
   }catch{}
  },30000);
  return()=>{active=false;clearInterval(timer)};
 },[client,storeId,manager]);
 const update=(key,value)=>setProgram(old=>({...old,[key]:value}));
 async function persistProgram(values,close=false){
  if(loading||!ready)return false;setLoading(true);setError('');setMessage('');
  try{
   const data={store_id:storeId,updated_at:new Date().toISOString()};
   for(const key of Object.keys(defaults))data[key]=typeof defaults[key]==='boolean'?!!values[key]:Number(values[key]);
   if(data.cashback_enabled&&data.cashback_percent<=0)throw Error('Informe o percentual de cashback antes de ativar.');
   if(data.referrals_enabled&&data.referral_reward_cents+data.referral_welcome_cents<=0)throw Error('Configure os créditos da indicação antes de ativar.');
   const {error}=await client.from('loyalty_programs').upsert(data,{onConflict:'store_id'});if(error)throw error;
   setProgram({...defaults,...data});setSavedProgram({...defaults,...data});
   setMessage('Regras salvas. Os benefícios já estão disponíveis conforme a ativação da loja.');
   if(close)closeDrawer(true,data);return true;
  }catch(e){setError(e.message||String(e));return false}finally{setLoading(false)}
 }
 function saveProgram(e){e.preventDefault();void persistProgram(program,!['Cupons','Campanhas'].includes(section));}
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
   form.reset();setOfferDirty(false);setEditing(null);setMessage('Oferta salva. Quando a modalidade estiver ativa, poderá ser usada no cardápio.');await refresh();
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
 function openDrawer(name,opener,draft=savedProgram){
  openerRef.current=opener;setProgram({...defaults,...draft});setEditing(null);setRecovered(null);setOfferDirty(false);setError('');setMessage('');setSection(name);
 }
 function closeDrawer(force=false,values=savedProgram){
  if(loading&&!force)return;
  const changed=Object.keys(defaults).some(key=>String(program[key])!==String(savedProgram[key]));
  if(!force&&(changed||offerDirty)&&!window.confirm('Descartar as alterações que ainda não foram salvas?'))return;
  setProgram({...defaults,...values});setSection('Visão geral');setEditing(null);setRecovered(null);setOfferDirty(false);
 }
 useEffect(()=>{
  const dialog=dialogRef.current;if(!dialog)return;
  if(section!=='Visão geral'&&!dialog.open)dialog.showModal();
  if(section==='Visão geral'&&dialog.open){dialog.close();if(openerRef.current?.isConnected)openerRef.current.focus();}
 },[section]);
 async function toggleCard(card,opener){
  if(loading||!ready)return;
  const next={...savedProgram};
  if(card.id==='points'){const enabled=savedProgram.points_enabled||savedProgram.orders_enabled;next.points_enabled=!enabled;if(enabled)next.orders_enabled=false;}
  else next[card.key]=!savedProgram[card.key];
  if((card.id==='cashback'&&next.cashback_enabled&&Number(next.cashback_percent)<=0)||
    (card.id==='referral'&&next.referrals_enabled&&Number(next.referral_reward_cents)+Number(next.referral_welcome_cents)<=0)){
   openDrawer(card.section,opener,next);return;
  }
  await persistProgram(next);
 }
 const toggle=(key,label)=><label className="fl-setting-toggle"><span>{label}</span><input type="checkbox" checked={!!program[key]} onChange={e=>update(key,e.target.checked)}/></label>;
 const number=(key,label,min,max,step=1)=>{
  const currency=key.endsWith('_cents');
  return <label className="field">{label}<input type="number" min={currency?min/100:min} max={currency?max/100:max} step={currency ? 0.01 : step} required
   value={program[key]===''?'':currency?Number(program[key])/100:program[key]}
   onChange={e=>update(key,e.target.value===''?'':currency?Math.round(Number(e.target.value)*100):e.target.value)}/></label>;
 };
 const sectionKind=section==='Campanhas'?'campaign':'coupon';
 const availableOffers=kind=>coupons.filter(c=>c.kind===kind&&c.active&&(!c.starts_at||Date.parse(c.starts_at)<=Date.now())&&(!c.expires_at||Date.parse(c.expires_at)>Date.now())&&(!c.max_uses||c.uses<c.max_uses)).length;
 const cards=[
  {id:'points',title:'Pontos e recompensas',section:'Clientes e pontos',icon:Gift,color:'amber',description:'Recompense cada compra do cliente.',extra:'Pontos ou quantidade de pedidos',active:!!(savedProgram.points_enabled||savedProgram.orders_enabled),summary:savedProgram.points_enabled?`${savedProgram.points_per_real} ponto(s) por R$ 1 • ${savedProgram.min_points_to_redeem} pontos = ${money(savedProgram.points_reward_cents)}`:savedProgram.orders_enabled?`${savedProgram.orders_required} pedidos = ${money(savedProgram.orders_reward_cents)}`:'Defina pontos ou recompensa por pedidos'},
  {id:'coupons',key:'coupons_enabled',title:'Cupons',section:'Cupons',icon:Ticket,color:'green',description:'Crie ofertas para todos ou clientes específicos.',active:!!savedProgram.coupons_enabled,summary:`${availableOffers('coupon')} cupom(ns) disponível(is)`},
  {id:'campaigns',key:'campaigns_enabled',title:'Campanhas',section:'Campanhas',icon:Megaphone,color:'gray',description:'Divulgue ofertas com início e fim definidos.',active:!!savedProgram.campaigns_enabled,summary:savedProgram.campaigns_enabled&&availableOffers('campaign')?`${availableOffers('campaign')} campanha(s) ativa(s)`:'Nenhuma campanha ativa'},
  {id:'cashback',key:'cashback_enabled',title:'Cashback',section:'Cashback',icon:RefreshCw,color:'green',description:'Devolva parte da compra em créditos.',active:!!savedProgram.cashback_enabled,summary:savedProgram.cashback_enabled?`${savedProgram.cashback_percent}% de volta • uso de até ${savedProgram.cashback_max_redeem_percent}% do pedido`:'Defina o percentual e o limite de uso'},
  {id:'referral',key:'referrals_enabled',title:'Indique e ganhe',section:'Indique e ganhe',icon:UserPlus,color:'purple',description:'Incentive clientes a trazer novos participantes.',active:!!savedProgram.referrals_enabled,summary:savedProgram.referrals_enabled?`${money(savedProgram.referral_reward_cents)} para quem indica • ${money(savedProgram.referral_welcome_cents)} para o novo cliente`:'Defina os créditos para cada participante'},
  {id:'customers',title:'Clientes e carteiras',section:'Clientes e carteiras',icon:Users,color:'blue',description:'Acompanhe saldos e histórico de benefícios.',management:true,summary:'Consulte pontos, pedidos e créditos.'}
 ];
 const drawerTitle=section==='Clientes e pontos'?'Pontos e recompensas':section;
 const drawerMeta={
  'Clientes e pontos':{icon:Gift,tone:'amber',description:'Configure os pontos e as recompensas por compras.'},
  'Cupons':{icon:Ticket,tone:'purple',description:'Crie e gerencie somente cupons de desconto.'},
  'Campanhas':{icon:Megaphone,tone:'blue',description:'Crie e gerencie somente campanhas promocionais.'},
  'Cashback':{icon:RefreshCw,tone:'green',description:'Escolha quanto retorna ao cliente em crédito.'},
  'Indique e ganhe':{icon:UserPlus,tone:'orange',description:'Defina os créditos para indicações de novos clientes.'},
  'Clientes e carteiras':{icon:Users,tone:'blue',description:'Acompanhe clientes, saldos e acesso às carteiras.'}
 }[section]||{icon:Gift,tone:'orange',description:'Configure os benefícios desta modalidade.'};
 const DrawerIcon=drawerMeta.icon;
 const shownCustomers=customers.filter(c=>(c.name+' '+c.phone).toLocaleLowerCase('pt-BR').includes(customerQuery.toLocaleLowerCase('pt-BR')));
 const creditTotal=customers.reduce((sum,c)=>sum+Math.max(0,Number(c.cashback_cents)||0),0);
 const publicLink=(label,primary=false)=>menuLink?<a className={primary?'fl-button fl-button--primary':'fl-button'} href={menuLink} target="_blank" rel="noopener noreferrer">{!primary&&<ExternalLink size={17}/>} {label}</a>:<button className={primary?'fl-button fl-button--primary':'fl-button'} disabled title="Ative o cardápio digital da loja para visualizar.">{label}</button>;
 if(!manager)return <section className="panel"><h2>Fideliza+</h2><p>Somente gestores podem administrar os benefícios da loja.</p></section>;
 return <section aria-label="Fideliza+" className="loyalty-page" aria-busy={loading}>
  <div className="fl-heading"><div><div className="fl-breadcrumb">Relacionamento <span>/</span> <strong>Fideliza+</strong></div><h2>Transforme compras em novas visitas</h2><p>Escolha os benefícios que combinam com a sua loja.</p></div>{publicLink('Ver no cardápio')}</div>
  <div className="fl-metrics" aria-label="Resumo do Fideliza+">
   {[{label:'Clientes participantes',value:ready?customers.length:'—',icon:Users},{label:'Benefícios utilizados',value:used??'—',icon:Gift},{label:'Créditos disponíveis',value:ready?money(creditTotal):'—',icon:Coins}].map(metric=><article className="fl-metric" key={metric.label}><span className="fl-metric-icon"><metric.icon size={27}/></span><div><span>{metric.label}</span><strong>{metric.value}</strong></div></article>)}
  </div>
  {statsError&&<p className="fl-inline-notice" role="status">{statsError}<button type="button" onClick={()=>void refresh()} disabled={loading}>Atualizar</button></p>}
  {section==='Visão geral'&&error&&<p role="alert" className="fl-feedback fl-feedback--error">{error}</p>}{section==='Visão geral'&&message&&<p role="status" className="fl-feedback">{message}</p>}
  <div className="fl-section-heading"><h3>Benefícios da sua loja</h3><select aria-label="Filtrar benefícios" value={filter} onChange={e=>setFilter(e.target.value)}><option>Todos</option><option>Ativos</option><option>Inativos</option></select></div>
  <div className="fl-benefits">
   {cards.filter(card=>filter==='Todos'||!card.management&&(filter==='Ativos'?card.active:!card.active)).map(card=><article className={'fl-benefit fl-benefit--'+card.color} key={card.id} aria-label={card.title}>
    <div className="fl-card-main"><span className="fl-card-icon"><card.icon size={29}/></span><div className="fl-card-copy"><span className={'fl-badge '+(card.management?'fl-badge--management':card.active?'fl-badge--active':'fl-badge--inactive')}>{card.management?'Gestão':card.active?'Ativo':'Inativo'}</span><h4>{card.title}</h4><p>{card.description}</p>{card.extra&&<small>{card.extra}</small>}</div>
     {!card.management&&<button type="button" className="fl-switch" role="switch" aria-label={'Ativar '+card.title} aria-checked={card.active} disabled={loading||!ready} onClick={event=>void toggleCard(card,event.currentTarget)}><span/></button>}
    </div><div className="fl-card-rule"><card.icon size={18}/><span>{card.summary}</span></div>
    <button type="button" className="fl-configure" disabled={loading||!ready} onClick={event=>openDrawer(card.section,event.currentTarget)}>{card.management?'Ver clientes':'Configurar'}<ArrowRight size={18}/></button>
   </article>)}
  </div>
  <div className="fl-bottom"><div className="fl-trust"><ShieldCheck size={32}/><div><strong>Benefícios liberados após pagamento e entrega confirmados.</strong><p>Cada loja escolhe suas regras. Cancelamentos revertem os lançamentos.</p></div></div><div className="fl-preview"><span className="fl-preview-icon"><Smartphone size={29}/></span><div><strong>No cardápio do cliente</strong><p>Seus benefícios aparecem em Meu Fideliza+.</p></div>{publicLink('Pré-visualizar',true)}</div></div>
  <dialog ref={dialogRef} className="fl-dialog" aria-labelledby="fl-drawer-title" onCancel={event=>{event.preventDefault();closeDrawer()}} onClick={event=>{if(event.target===dialogRef.current)closeDrawer()}}>
   <div className="fl-drawer-inner"><header className={'fl-drawer-heading fl-drawer-heading--'+drawerMeta.tone}><div className="fl-drawer-heading-copy"><span className="fl-eyebrow">Fideliza+ / Configurar benefício</span><div className="fl-drawer-title-row"><span className="fl-drawer-hero-icon"><DrawerIcon size={27}/></span><div><h2 id="fl-drawer-title">{drawerTitle}</h2><p>{drawerMeta.description}</p></div></div></div><button type="button" className="fl-close" aria-label="Fechar configuração" disabled={loading} onClick={()=>closeDrawer()}><X size={23}/></button></header>
    <div className="fl-drawer-content">{error&&<p role="alert" className="fl-feedback fl-feedback--error">{error}</p>}{message&&<p role="status" className="fl-feedback">{message}</p>}
  {section==='Clientes e pontos'&&<><form className="panel fl-setting-form fl-setting-form--points" onSubmit={saveProgram}><div className="fl-subsection-title"><Gift size={21}/><div><h3>Acúmulo de pontos</h3><p>Defina como o cliente acumula e utiliza pontos.</p></div></div>
   {toggle('points_enabled','Ativar pontos')}{number('points_per_real','Pontos por R$ 1 em produtos',0,1000,.01)}
   {number('min_points_to_redeem','Pontos necessários para um resgate',1,10000000)}{number('points_reward_cents','Desconto do resgate (R$)',1,1000000)}
   <div className="fl-subsection-title fl-subsection-title--second"><Gift size={21}/><div><h3>Recompensa por pedidos</h3><p>Ofereça um benefício após uma quantidade de compras.</p></div></div>
   {toggle('orders_enabled','Ativar recompensa por quantidade de pedidos')}{number('orders_required','Pedidos para um resgate',1,1000)}{number('orders_reward_cents','Desconto da recompensa por pedidos (R$)',1,1000000)}
   {number('minimum_order_cents','Compra mínima para acumular (R$)',0,1000000)}
   <p className="hint">Um pedido pago e entregue acumula uma participação. O resgate desconta a quantidade configurada; o saldo restante é preservado.</p><button disabled={loading||!ready}>Salvar regras de pontos</button></form>
   </>}
  {section==='Clientes e carteiras'&&<><label className="fl-customer-search"><Search size={18}/><input aria-label="Buscar cliente" placeholder="Buscar por nome ou telefone" value={customerQuery} onChange={e=>setCustomerQuery(e.target.value)}/></label><div className="panel fl-customers-panel"><div className="fl-subsection-title"><Users size={21}/><div><h3>Clientes e carteiras</h3><p>Consulte os benefícios desta loja.</p></div></div>{!customers.length&&<p>Os clientes aparecerão após aderirem ao Fideliza+ pelo cardápio.</p>}{shownCustomers.map(c=><div className="line" key={c.id}><b>{c.name}</b><span>{c.phone} · {c.points} pontos · {c.orders} pedidos · Créditos {money(c.cashback_cents)}</span><button className="secondary" disabled={loading||!ready} onClick={()=>resetKey(c)}>Recuperar acesso</button></div>)}
   {recovered&&<div role="status"><p>Nova chave de {recovered.name}. Entregue somente ao cliente após conferir a identidade.</p><input aria-label="Nova chave pessoal" readOnly value={recovered.key} onFocus={e=>e.target.select()}/><button type="button" onClick={()=>setRecovered(null)}>Ocultar chave</button></div>}</div></>}
  {['Cupons','Campanhas'].includes(section)&&<>
   <form className="panel fl-setting-form fl-activation-form" onSubmit={saveProgram}><div className="fl-subsection-title">{section==='Cupons'?<Ticket size={21}/>:<Megaphone size={21}/>}<div><h3>Disponibilidade no cardápio</h3><p>Ative somente esta modalidade para os clientes.</p></div></div>{toggle(section==='Campanhas'?'campaigns_enabled':'coupons_enabled','Ativar '+section.toLowerCase()+' no cardápio')}<button disabled={loading||!ready}>Salvar ativação</button></form>
   <form className="panel fl-setting-form fl-offer-form" key={editing?.id||section} onChangeCapture={()=>setOfferDirty(true)} onSubmit={saveCoupon}><div className="fl-subsection-title">{section==='Cupons'?<Ticket size={21}/>:<Megaphone size={21}/>}<div><h3>{editing?'Editar oferta':section==='Campanhas'?'Criar campanha':'Criar cupom'}</h3><p>Defina desconto, validade e limites do benefício.</p></div></div>
    <label className="field">Nome da oferta<input name="title" maxLength={120} required={section==='Campanhas'} defaultValue={editing?.title||''}/></label>
    <label className="field">Código<input name="code" maxLength={32} required disabled={!!editing} defaultValue={editing?.code||''} placeholder="VOLTE10"/></label>
    <label className="field">Tipo<select aria-label="Tipo do desconto" name="discount_type" defaultValue={editing?.discount_type||'percent'}><option value="percent">Porcentagem (%)</option><option value="fixed">Valor fixo (R$)</option></select></label>
    <label className="field">Desconto<input name="discount_value" type="number" step="0.01" min="0.01" required defaultValue={editing?.discount_value||''}/></label>
    <label className="field">Pedido mínimo em produtos (R$)<input name="minimum_order" type="number" step="0.01" min="0" defaultValue={(editing?.minimum_order_cents||0)/100}/></label>
    <label className="field">Limite total de utilizações<input name="max_uses" type="number" min="1" defaultValue={editing?.max_uses||''}/></label>
    <label className="field">Limite por cliente (exige acesso à carteira)<input name="per_customer_limit" type="number" min="1" max="10000" defaultValue={editing?.per_customer_limit||''}/></label>
    <label className="field">Cliente exclusivo<select aria-label="Cliente exclusivo" name="target_customer_id" defaultValue={editing?.target_customer_id||''}><option value="">Todos os clientes</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}</select></label>
    <label className="field">Início (Brasília)<input name="starts_at" type="date" defaultValue={dateValue(editing?.starts_at)}/></label>
    <label className="field">Fim (Brasília)<input name="expires_at" type="date" defaultValue={dateValue(editing?.expires_at)}/></label>
    <p className="hint">Campanhas vigentes aparecem no cardápio com código, desconto e condições. Um pedido usa um cupom ou um resgate; não há acúmulo de descontos.</p>
    <button disabled={loading||!ready}>{editing?'Salvar alterações':'Cadastrar oferta'}</button>{editing&&<button type="button" className="secondary" onClick={()=>setEditing(null)}>Cancelar edição</button>}
   </form>
   <div className="panel fl-offer-list"><div className="fl-subsection-title">{section==='Cupons'?<Ticket size={21}/>:<Megaphone size={21}/>}<div><h3>{section==='Cupons'?'Cupons cadastrados':'Campanhas cadastradas'}</h3><p>Editar, ativar e desativar ofertas desta modalidade.</p></div></div>{coupons.filter(c=>c.kind===sectionKind).map(c=><div className="line" key={c.id}><b>{c.title||c.code} · {c.code}</b><span>{c.discount_type==='percent'?c.discount_value+'%':money(c.discount_value*100)} · {c.uses} uso(s){c.max_uses?'/'+c.max_uses:''}{c.active?' · Ativa':' · Desativada'}</span><button className="secondary" disabled={loading||!ready} onClick={()=>{setEditing(c);setOfferDirty(false)}}>Editar</button><button className="secondary" disabled={loading||!ready} onClick={()=>toggleCoupon(c)}>{c.active?'Desativar':'Ativar'}</button><button className="secondary" disabled={loading||Number(c.uses)>0} onClick={()=>deleteCoupon(c)}>Excluir</button></div>)}{!coupons.some(c=>c.kind===sectionKind)&&<p>Nenhuma oferta cadastrada nesta modalidade.</p>}</div>
  </>}
  {section==='Cashback'&&<form className="panel fl-setting-form fl-cashback-form" onSubmit={saveProgram}><div className="fl-subsection-title"><RefreshCw size={21}/><div><h3>Cashback em compras</h3><p>Créditos para uma próxima compra na mesma loja.</p></div></div>{toggle('cashback_enabled','Ativar cashback')}
   {number('cashback_percent','Percentual sobre produtos pagos, após descontos (%)',0,50,.01)}{number('cashback_max_redeem_percent','Percentual máximo dos produtos que os créditos podem pagar (%)',1,100,.01)}
   <p>Exemplo: R$ 100 em produtos com 5% de cashback geram R$ 5 após pagamento e entrega. Créditos ficam na carteira desta loja e podem ser usados em outra compra.</p><button disabled={loading||!ready}>Salvar cashback</button></form>}
  {section==='Indique e ganhe'&&<form className="panel fl-setting-form fl-referral-form" onSubmit={saveProgram}><div className="fl-subsection-title"><UserPlus size={21}/><div><h3>Indique e ganhe</h3><p>Recompense a pessoa que indica e o novo cliente.</p></div></div>{toggle('referrals_enabled','Ativar indicações')}
   {number('referral_reward_cents','Crédito para quem indica (R$)',0,100000)}{number('referral_welcome_cents','Crédito para o novo cliente (R$)',0,100000)}
   <p>O cliente compartilha seu código pessoal. A indicação deve ser informada no cadastro de um novo participante. Os créditos são liberados uma vez, na primeira compra paga e entregue que alcançar o mínimo da loja. Autoindicação pelo mesmo telefone é recusada.</p><button disabled={loading||!ready}>Salvar indicações</button></form>}

    </div><footer className="fl-drawer-footer"><ShieldCheck size={16}/><span>Suas regras e históricos são preservados.</span><button type="button" className="fl-button" disabled={loading} onClick={()=>closeDrawer()}>Voltar à visão geral</button></footer></div>
  </dialog>
 </section>;
}
