"""Read-only customer history from already loaded store orders; no new database permissions."""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
needle="function App(){"
assert s.count(needle)==1
component="""function CustomersFromOrders({orders=[],storeId}){
 const [query,setQuery]=useState('');
 const [selectedCustomer,setSelectedCustomer]=useState(null);
 const [blocks,setBlocks]=useState({});
 const [blockError,setBlockError]=useState('');
 const [blockBusy,setBlockBusy]=useState(false);
 useEffect(()=>{
  let live=true;
  setBlocks({});setSelectedCustomer(null);setBlockError('');
  if(!storeId)return;
  supabase.from('customer_blocks').select('customer_phone').eq('store_id',storeId).then(({data,error})=>{
   if(!live)return;
   if(error){setBlockError('Bloqueios indisponíveis: configuração do banco de dados pendente.');return;}
   setBlocks(Object.fromEntries((data||[]).map(x=>[x.customer_phone,true])));
  });
  return()=>{live=false};
 },[storeId]);
 async function toggleBlock(c){
  if(!c.phone){setBlockError('O cliente precisa ter telefone para bloqueio seguro.');return;}
  setBlockBusy(true);setBlockError('');
  const blocked=!!blocks[c.phone];
  const result=blocked
   ?await supabase.from('customer_blocks').delete().eq('store_id',storeId).eq('customer_phone',c.phone)
   :await supabase.from('customer_blocks').insert({store_id:storeId,customer_phone:c.phone});
  if(result.error){setBlockError(result.error.message||'Não foi possível atualizar o bloqueio.');}
  else setBlocks(old=>({...old,[c.phone]:!blocked}));
  setBlockBusy(false);
 }

 const customers=new Map();
 for(const order of orders){
  if(!storeId||order.store_id!==storeId)continue;
  const name=String(order.customer_name||'').trim();
  if(!name)continue;
  const phone=String(order.customer_phone||'').trim();
  // Without a phone, names alone are not reliable unique customer identifiers.
  const key=phone?'phone:'+phone:'order:'+String(order.id);
  const row=customers.get(key)||{name,phone,count:0,total:0,last:''};
  row.count+=1;
  const amount=Number(order.gross);
  if(Number.isFinite(amount))row.total+=amount;
  const when=String(order.created_at||'');
  if(when>row.last)row.last=when;
  customers.set(key,row);
 }
 const list=[...customers.values()].sort((a,b)=>b.last.localeCompare(a.last)).filter(c=>(c.name+' '+c.phone).toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
 return <section className="panel"><h3>Clientes e histórico de pedidos</h3><p>Clientes identificados nos pedidos desta loja. O cadastro independente e o bloqueio de clientes ainda precisam de integração própria.</p><div className="quick-actions"><input aria-label="Buscar cliente" placeholder="Buscar nome ou telefone" value={query} onChange={e=>setQuery(e.target.value)}/><strong>{list.length} cliente(s)</strong></div><div style={{overflowX:'auto'}}><table style={{width:'100%',textAlign:'left',borderCollapse:'collapse'}}><thead><tr><th>Cliente</th><th>Telefone</th><th>Pedidos</th><th>Total registrado</th></tr></thead><tbody>{list.map((c,i)=><tr key={c.phone||c.name+i}><td><button type="button" className="secondary" onClick={()=>{setSelectedCustomer(c);setBlockError('')}}>{c.name}</button></td><td>{c.phone||'—'}</td><td>{c.count}</td><td>{money(c.total)}</td></tr>)}</tbody></table></div>{!list.length&&<p>Nenhum cliente encontrado nos pedidos carregados.</p>}
 {selectedCustomer&&<div className="panel" aria-label="Detalhes do cliente"><h3>{selectedCustomer.name}</h3><p>{selectedCustomer.phone||'Telefone não informado'} · {selectedCustomer.count} pedido(s) · {money(selectedCustomer.total)}</p><p>{blocks[selectedCustomer.phone]?'Cliente bloqueado nesta loja.':'Cliente não bloqueado nesta loja.'}</p><button type="button" disabled={blockBusy||!selectedCustomer.phone} onClick={()=>toggleBlock(selectedCustomer)}>{blocks[selectedCustomer.phone]?'Desbloquear':'Bloquear'}</button><button type="button" className="secondary" onClick={()=>setSelectedCustomer(null)}>Fechar</button>{blockError&&<p role="alert">{blockError}</p>}</div>}
</section>
}
"""
s=s.replace(needle,component+needle,1)
needle="{active&&!isDriver&&tab==='Caixa'&&<CashDesk"
assert s.count(needle)==1
s=s.replace(needle,"{active&&!isDriver&&manager&&tab==='Clientes'&&<CustomersFromOrders orders={orders} storeId={selected}/> }\n{active&&!isDriver&&!manager&&tab==='Clientes'&&<section className=\"panel\"><p>O histórico de clientes está disponível somente para gestores autorizados.</p></section>}\n"+needle,1)
p.write_text(s,encoding='utf-8')
