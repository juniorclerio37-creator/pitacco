import React,{useEffect,useState} from 'react';

export default function IfoodConnections({client,storeId,canRead,test=false}){
 const [rows,setRows]=useState(null),[linking,setLinking]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [merchant,setMerchant]=useState(''),[authorization,setAuthorization]=useState(null),[code,setCode]=useState('');
 const [ready,setReady]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(!canRead)return;
  let live=true;
  (async()=>{
   try{
    const [connections,approval]=await Promise.all([
     client.rpc('pitacco_ifood_connections',{p_store:storeId}),client.rpc('pitacco_ifood_linking_status'),
    ]);
    if(connections.error||approval.error)throw connections.error||approval.error;
    if(live){setRows(connections.data||[]);setLinking(approval.data===true);}
   }catch(error){if(live)setError(error.message||'Não foi possível consultar o iFood.');}
   finally{if(live)setReady(true);}
  })();
  return()=>{live=false;};
 },[client,storeId,canRead,attempt]);
 function reset(){setAuthorization(null);setCode('');setError('');}
 async function connect(event){
  event.preventDefault();
  setBusy(true);setError('');setNotice('');
  try{
   const payload=authorization?{action:'finish',reference:authorization.reference,code}:{action:'start',merchant:merchant.trim()};
   const response=await client.functions.invoke('ifood-orders/connect',{body:{...payload,store:storeId,test}});
   if(response.error){
    const detail=response.error.context instanceof Response?await response.error.context.clone().json().catch(()=>null):null;
    if(authorization){setAuthorization(null);setCode('');}
    throw Error(detail?.error||'O serviço de vínculo do iFood está indisponível.');
   }
   if(authorization){
    reset();setMerchant('');setNotice('Conta vinculada. O recebimento de pedidos é automático.');
    setAttempt(value=>value+1);
   }else setAuthorization(response.data);
  }catch(error){setError(error.message||'Não foi possível concluir o vínculo.');}
  finally{setBusy(false);}
 }
 return <section className="panel" aria-label="Integração com iFood">
  <h3>Vincular estabelecimento</h3>
  {canRead&&!ready&&<p role="status">Consultando vínculos…</p>}
  {!canRead&&<p>O gestor da loja pode consultar e vincular as contas.</p>}
  {canRead&&rows?.length===0&&<p>Nenhuma conta iFood vinculada.</p>}
  {canRead&&rows?.length>0&&<ul>{rows.filter(row=>test||!row.test_only).map(row=><li key={row.merchant_id}>
   <code>{row.merchant_id}</code> · {row.test_only?'Homologação':'Produção'} · {row.enabled?'Vínculo habilitado':'Vínculo pausado'}
  </li>)}</ul>}
  {canRead&&ready&&(test||linking)&&<form onSubmit={connect}>
   {!authorization?<label>Identificador da loja no iFood (Merchant ID)
    <input value={merchant} onChange={e=>setMerchant(e.target.value)} required maxLength={36}
     pattern="[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"/>
   </label>:<>
    <p>Abra o Portal do Parceiro e autorize o Pitacco com o código <strong>{authorization.userCode}</strong>.</p>
    <a href={authorization.portal} target="_blank" rel="noopener noreferrer">Autorizar no Portal do Parceiro iFood</a>
    <label>Código de autorização devolvido pelo iFood
     <input value={code} onChange={e=>setCode(e.target.value)} required maxLength={256} autoComplete="off"/>
    </label>
    <button type="button" className="secondary" disabled={busy} onClick={reset}>Gerar outro código</button>
   </>}
   <button disabled={busy}>{busy?'Consultando iFood…':authorization?'Vincular conta':'Gerar código de vínculo'}</button>
  </form>}
  {canRead&&ready&&!test&&!linking&&rows!==null&&<p>Vínculo disponível após a homologação geral pelo Pitacco.</p>}
  {!test&&<p>Pedidos recebidos aparecem em Pedidos. Use <strong>Ativar som de pedidos</strong> para ouvir o alerta no navegador.</p>}
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </section>;
}
