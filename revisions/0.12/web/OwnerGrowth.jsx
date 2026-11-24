import React,{useEffect,useState} from 'react';
const fmt=new Intl.NumberFormat('pt-BR');
const monthName=m=>new Intl.DateTimeFormat('pt-BR',{month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(m+'T00:00:00Z'));
export default function OwnerGrowth({client}){
 const [months,setMonths]=useState(6),[revision,refresh]=useState(0),[snapshot,setSnapshot]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(true);
 useEffect(()=>{let live=true;const abort=new AbortController();setBusy(true);setError('');setSnapshot(null);
 client.rpc('pitacco_owner_growth',{p_months:months}).abortSignal(abort.signal).then(({data,error})=>{if(!live)return;if(error||!Array.isArray(data?.months))throw error||Error('Dados indisponíveis');setSnapshot(data)}).catch(e=>{if(live)setError(e.message||'Não foi possível consultar os indicadores.')}).finally(()=>{if(live)setBusy(false)});
 return()=>{live=false;abort.abort()}},[client,months,revision]);
 const rows=snapshot?.months||[],max=Math.max(1,...rows.map(r=>r.new_stores));
 return <section className="panel" aria-label="Indicadores e crescimento" aria-busy={busy}>
 <div className="admin-finance-filters"><label>Período<select value={months} onChange={e=>setMonths(Number(e.target.value))}><option value={3}>3 meses</option><option value={6}>6 meses</option><option value={12}>12 meses</option></select></label><button type="button" className="secondary" disabled={busy} onClick={()=>refresh(n=>n+1)}>Atualizar indicadores</button></div>
 <p>Cadastros e pedidos registrados por mês, no horário de Brasília. O mês atual está em andamento. Os números não representam faturamento ou pagamentos confirmados.</p>
 {busy&&<p role="status">Carregando indicadores…</p>}{error&&<p role="alert">{error}</p>}
 {snapshot&&<><div className="owner-dashboard-metrics"><article><span>Novas lojas no período</span><strong>{fmt.format(rows.reduce((a,r)=>a+r.new_stores,0))}</strong></article><article><span>Pedidos registrados no período</span><strong>{fmt.format(rows.reduce((a,r)=>a+r.orders,0))}</strong></article><article><span>Pedidos cancelados no período</span><strong>{fmt.format(rows.reduce((a,r)=>a+r.cancelled,0))}</strong></article></div>
 <h3>Novos estabelecimentos por mês</h3><div className="admin-growth-bars" aria-hidden="true">{rows.map(r=><div key={r.month}><strong>{fmt.format(r.new_stores)}</strong><span style={{height:(r.new_stores/max*100)+'%'}}/><small>{monthName(r.month)}</small></div>)}</div>
 <div className="owner-dashboard-table"><table aria-label="Evolução mensal"><thead><tr><th>Mês</th><th>Novas lojas</th><th>Pedidos registrados</th><th>Cancelados</th></tr></thead><tbody>{rows.map(r=><tr key={r.month}><th scope="row">{monthName(r.month)}</th><td>{fmt.format(r.new_stores)}</td><td>{fmt.format(r.orders)}</td><td>{fmt.format(r.cancelled)}</td></tr>)}</tbody></table></div></>}
 </section>
}
