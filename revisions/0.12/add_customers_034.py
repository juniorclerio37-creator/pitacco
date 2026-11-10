"""Read-only customer history from already loaded store orders; no new database permissions."""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
needle="function App(){"
assert s.count(needle)==1
component="""function CustomersFromOrders({orders=[]}){
 const [query,setQuery]=useState('');
 const customers=new Map();
 for(const order of orders){
  const name=String(order.customer_name||'').trim();
  if(!name)continue;
  const phone=String(order.customer_phone||'').trim();
  const key=phone||name.toLocaleLowerCase('pt-BR');
  const row=customers.get(key)||{name,phone,count:0,total:0,last:''};
  row.count+=1;
  row.total+=Number(order.total||0);
  const when=String(order.created_at||'');
  if(when>row.last)row.last=when;
  customers.set(key,row);
 }
 const list=[...customers.values()].sort((a,b)=>b.last.localeCompare(a.last)).filter(c=>(c.name+' '+c.phone).toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
 return <section className="panel"><h3>Clientes e histórico de pedidos</h3><p>Clientes identificados nos pedidos desta loja. O cadastro independente e o bloqueio de clientes ainda precisam de integração própria.</p><div className="quick-actions"><input aria-label="Buscar cliente" placeholder="Buscar nome ou telefone" value={query} onChange={e=>setQuery(e.target.value)}/><strong>{list.length} cliente(s)</strong></div><div style={{overflowX:'auto'}}><table style={{width:'100%',textAlign:'left',borderCollapse:'collapse'}}><thead><tr><th>Cliente</th><th>Telefone</th><th>Pedidos</th><th>Total registrado</th></tr></thead><tbody>{list.map((c,i)=><tr key={c.phone||c.name+i}><td>{c.name}</td><td>{c.phone||'—'}</td><td>{c.count}</td><td>{money(c.total)}</td></tr>)}</tbody></table></div>{!list.length&&<p>Nenhum cliente encontrado nos pedidos carregados.</p>}</section>
}
"""
s=s.replace(needle,component+needle,1)
needle="{active&&!isDriver&&tab==='Caixa'&&<CashDesk"
assert s.count(needle)==1
s=s.replace(needle,"{active&&!isDriver&&tab==='Clientes'&&<CustomersFromOrders orders={orders}/> }\n"+needle,1)
p.write_text(s,encoding='utf-8')
