import React,{useEffect,useState} from 'react';

const payments={dinheiro:'Dinheiro',cartao_entrega:'Cartão na entrega',pix_manual:'Pix manual'};
const defaults={slug:'',enabled:false,delivery_enabled:true,pickup_enabled:false,delivery_fee:0,payment_methods:['dinheiro'],pix_instructions:'',preparation_minutes:30};

export default function OwnerMenuSettings({client,storeId,storefrontOrigin}){
 const [settings,setSettings]=useState(null),[exists,setExists]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{
  let active=true;
  client.rpc('pitacco_owner_menu_settings',{p_store:storeId}).then(({data,error})=>{
   if(!active)return;
   if(error)setError(error.message);
   else {setSettings({...defaults,...data});setExists(!!data);}
  }).catch(failure=>{if(active)setError(failure.message);});
  return()=>{active=false;};
 },[client,storeId]);
 const change=(key,value)=>setSettings(old=>({...old,[key]:value}));
 async function save(event,preparation=false){
  event.preventDefault();setBusy(true);setError('');setNotice('');
  try{
   const result=preparation
    ?await client.rpc('pitacco_save_preparation_minutes',{p_store:storeId,p_minutes:Number(settings.preparation_minutes)})
    :await client.rpc('save_public_menu_settings',{
      p_store:storeId,p_slug:settings.slug.trim().toLowerCase(),p_enabled:settings.enabled,
      p_delivery_enabled:settings.delivery_enabled,p_pickup_enabled:settings.pickup_enabled,
      p_delivery_fee:Number(settings.delivery_fee),p_payment_methods:settings.payment_methods,
      p_pix_instructions:settings.pix_instructions
     });
   if(result.error)throw result.error;
   if(!preparation)setExists(true);
   setNotice(preparation?'Tempo de preparo salvo.':'Configuração do checkout salva.');
  }catch(failure){setError(failure.message||'Não foi possível salvar.');}
  finally{setBusy(false);}
 }
 return <section className="panel" aria-label="Checkout do estabelecimento" aria-busy={busy}>
  <h3>Cardápio público e checkout</h3>
  {error&&<p role="alert">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  {settings&&<>
   <form onSubmit={save}>
    <label>Endereço do cardápio <input required minLength={3} maxLength={60} value={settings.slug} onChange={event=>change('slug',event.target.value)}/></label>
    {exists&&storefrontOrigin&&settings.slug&&<a href={storefrontOrigin+'/cardapio/?loja='+encodeURIComponent(settings.slug)} target="_blank" rel="noopener noreferrer">Abrir cardápio</a>}
    <label><input type="checkbox" checked={settings.enabled} onChange={event=>change('enabled',event.target.checked)}/> Cardápio publicado</label>
    <label><input type="checkbox" checked={settings.delivery_enabled} onChange={event=>change('delivery_enabled',event.target.checked)}/> Aceitar entrega</label>
    <label><input type="checkbox" checked={settings.pickup_enabled} onChange={event=>change('pickup_enabled',event.target.checked)}/> Aceitar retirada</label>
    <label>Taxa de entrega <input required type="number" min={0} max={1000} step=".01" value={settings.delivery_fee} onChange={event=>change('delivery_fee',event.target.value)}/></label>
    <fieldset><legend>Formas de pagamento</legend>
     {Object.entries(payments).map(([key,label])=><label key={key}><input type="checkbox" checked={settings.payment_methods.includes(key)} onChange={event=>
      change('payment_methods',event.target.checked?[...settings.payment_methods,key]:settings.payment_methods.filter(method=>method!==key))}/> {label}</label>)}
    </fieldset>
    <label>Instruções para Pix manual <textarea maxLength={1000} value={settings.pix_instructions} onChange={event=>change('pix_instructions',event.target.value)}/></label>
    <button disabled={busy}>Salvar checkout</button>
   </form>
   {exists&&<form onSubmit={event=>save(event,true)}>
    <label>Tempo de preparo em minutos <input required type="number" min={5} max={180} value={settings.preparation_minutes} onChange={event=>change('preparation_minutes',event.target.value)}/></label>
    <button disabled={busy}>Salvar tempo de preparo</button>
   </form>}
  </>}
 </section>;
}
