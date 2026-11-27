import React,{useEffect,useState} from 'react';

// Cada loja decide apenas o comprimento do PIN que será gerado para pedidos
// NOVOS do seu cardápio. Nunca altera o PIN de pedidos anteriores ou do iFood.
export default function DeliveryCodeSettings({client,storeId}){
 const [digits,setDigits]=useState(6),[busy,setBusy]=useState(false);
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{
  if(!client||!storeId)return;
  let active=true;
  setReady(false);setError('');setNotice('');
  client.rpc('pitacco_store_delivery_code_length',{p_store:storeId})
   .then(({data,error})=>{
    if(!active)return;
    if(error){setError(error.message||'Não foi possível consultar a regra de entrega.');return;}
    setDigits(Number(data||6));setReady(true);
   }).catch(e=>{if(active)setError(e.message||'Não foi possível carregar a configuração.');});
  return()=>{active=false;};
 },[client,storeId]);
 async function save(event){
  event.preventDefault();
  if(!ready||busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   const {data,error}=await client.rpc('pitacco_save_store_delivery_code_length',{
    p_store:storeId,p_digits:Number(digits)
   });
   if(error)throw error;
   if(Number(data)!==Number(digits))throw Error('O servidor não confirmou a alteração.');
   setNotice('Quantidade de dígitos salva para os próximos pedidos da loja.');
  }catch(e){setError(e.message||'Não foi possível salvar a configuração.');}
  finally{setBusy(false);}
 }
 return <section className="panel" aria-label="Configuração do código de confirmação de entrega">
  <h3>Código de confirmação das entregas da loja</h3>
  <p className="storefront-delivery-note">Defina quantos dígitos o cliente receberá nos novos pedidos feitos pelo cardápio Pitacco. O entregador precisará informar o código correto para finalizar.</p>
  <form onSubmit={save}>
   <fieldset disabled={busy||!ready}>
    <legend>Tamanho do código da loja</legend>
    <label>Quantidade de dígitos
     <select aria-label="Quantidade de dígitos do código da loja" value={digits}
       onChange={event=>setDigits(Number(event.target.value))}>
      {[4,5,6,7,8].map(n=><option key={n} value={n}>{n} dígitos</option>)}
     </select>
    </label>
   </fieldset>
   <p className="storefront-delivery-note">Os pedidos já criados conservam o código original. Pedidos do iFood usam sempre 4 dígitos, validados diretamente pelo iFood.</p>
   {error&&<p role="alert">{error}</p>}
   {notice&&<p role="status">{notice}</p>}
   <button type="submit" disabled={!ready||busy}>{busy?'Salvando…':'Salvar regra do código'}</button>
  </form>
 </section>;
}
