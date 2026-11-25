import React,{useEffect,useState} from 'react';
export default function IfoodExternalShippingTest({client,store,quote,latitude,longitude}){
 const [fields,setFields]=useState({streetName:'',streetNumber:'',neighborhood:'',city:'',state:'RJ',postalCode:'',areaCode:'21',number:''}),[rows,setRows]=useState([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[pickup,setPickup]=useState({});
 const call=async(action,extra={})=>{const r=await client.functions.invoke('ifood-shipping',{body:{action,store_id:store,...extra}});if(r.error){const d=await r.error.context?.clone?.().json().catch(()=>null);throw Error(d?.error||'Shipping indisponível.')}return r.data};
 const refresh=async()=>setRows((await call('external_list')).orders||[]);
 useEffect(()=>{refresh().catch(()=>setMessage('Histórico de teste indisponível.'))},[client,store]);
 async function run(fn){setBusy(true);setMessage('');try{await fn()}catch(e){setMessage(e.message)}finally{setBusy(false)}}
 const unresolved=rows.some(r=>['requesting','uncertain'].includes(r.state));
 const used=rows.some(r=>r.quote_id===quote?.id&&r.state!=='quoted');
 return <section aria-label="Pedidos externos de homologação"><h5>Criação de entrega externa de teste</h5><p>Use apenas endereço e telefone de homologação. O item fictício de R$ 1,00 não entra nas vendas ou no financeiro do Pitacco. Não use dados de clientes reais.</p>
 {quote&&<form onSubmit={e=>{e.preventDefault();if(!window.confirm('Confirmar solicitação de entrega exclusivamente de homologação?'))return;run(async()=>{const {areaCode,number,...address}=fields;const r=await call('external_create',{quote_id:quote.id,netValue:quote.netValue,confirmed:true,phone:{areaCode,number},address:{...address,country:'BR',coordinates:{latitude,longitude}}});setMessage('Resultado: '+r.state+' · HTTP '+r.provider_http+(r.provider_code?' · '+r.provider_code:''));await refresh()})}}>
 {Object.entries({streetName:'Logradouro',streetNumber:'Número',neighborhood:'Bairro',city:'Cidade',state:'UF',postalCode:'CEP (8 dígitos)',areaCode:'DDD',number:'Telefone de teste'}).map(([k,label])=><label key={k}>{label}<input required value={fields[k]} maxLength={100} onChange={e=>setFields(f=>({...f,[k]:e.target.value}))}/></label>)}
 <button type="submit" disabled={busy||unresolved||used||Date.parse(quote.expirationAt)<=Date.now()}>Criar pedido externo de homologação</button></form>}
 {unresolved&&<p role="alert">Uma solicitação está sem resultado definitivo. Não repita a contratação até conciliar com o iFood.</p>}
 {message&&<p role="status">{message}</p>}
 <button type="button" disabled={busy} onClick={()=>run(refresh)}>Atualizar pedidos externos</button>
 {rows.filter(r=>r.state!=='quoted').map(r=><article key={r.quote_id}><p>{r.external_id||r.quote_id} · {r.state} · HTTP {r.provider_http??'—'}</p>
 {r.tracking_url&&<a href={r.tracking_url} target="_blank" rel="noreferrer">Abrir rastreamento oficial</a>}
 {r.external_id&&<button type="button" disabled={busy} onClick={()=>run(async()=>{const d=await call('external_details',{external_id:r.external_id});if(!d.available)throw Error('Detalhes indisponíveis: '+(d.provider_code||d.provider_http));setPickup(p=>({...p,[r.external_id]:d.pickupCode||'Ainda não informado'}))})}>Consultar pickupCode</button>}
 {pickup[r.external_id]&&<p>Código de coleta: <strong>{pickup[r.external_id]}</strong></p>}</article>)}</section>
}
