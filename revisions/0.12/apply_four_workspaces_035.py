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
p=Path('web/style.css')
s=p.read_text(encoding='utf-8')
s+='\n'+Path('revisions/0.12/workspaces_013.css').read_text(encoding='utf-8')
p.write_text(s,encoding='utf-8')
