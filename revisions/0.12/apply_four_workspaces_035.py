"""Pitacco 0.13: four approved workspaces, no change to order/print/dispatch logic."""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
needle='<main><header>'
assert s.count(needle)==1
s=s.replace(needle,'<main className={\'pitacco-workspace pitacco-workspace--\'+(tab===\'Painel\'?\'overview\':tab===\'Pedidos\'||tab===\'Cozinha e expedição\'?\'orders\':[\'Entregadores\',\'Relatório de motoboys\',\'Pagamento de motoboys\'].includes(tab)?\'couriers\':tab===\'Configurações\'?\'settings\':\'other\')}><header>',1)
p.write_text(s,encoding='utf-8')
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
needle='<section hidden={!visible} aria-label='
assert s.count(needle)==1
s=s.replace(needle,'<section className={"pitacco-operations pitacco-operations--"+(view==="Configurações"?"printing":"orders")} hidden={!visible} aria-label=',1)
p.write_text(s,encoding='utf-8')
# Every store workspace uses the establishment identity, not the SaaS logo.
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
needle='<div className="brand"><img src="/pitacco-logo.png" alt="Pitacco"/><span>{nativeAvailable()?"Central de operações":"Gestão de delivery"}</span></div>'
assert s.count(needle)==1
replacement='<div className="brand store-identity">{storeBrand?.logo_url&&/^https:\\/\\//.test(storeBrand.logo_url)?<img src={storeBrand.logo_url} alt={"Logo de "+(active?.name||"loja")}/>:<span className="store-identity-placeholder" aria-hidden="true"><Store size={24}/></span>}<span className="store-identity-copy"><strong>{active?.name||"Seu estabelecimento"}</strong><small>Gestão de pedidos e vendas</small></span></div>'
s=s.replace(needle,replacement,1)
p.write_text(s,encoding='utf-8')
p=Path('web/style.css')
s=p.read_text(encoding='utf-8')
s+='\n'+Path('revisions/0.12/workspaces_013.css').read_text(encoding='utf-8')
p.write_text(s,encoding='utf-8')
