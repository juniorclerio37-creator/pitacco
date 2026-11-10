"""Improve subscription presentation without changing payment authorization or billing backend."""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
old="""<div className="panel"><h3>Assinatura de {active.name}</h3><p>Status: <b>{sub?.status||'Não cadastrada'}</b> · Mensalidade: {money(sub?.monthly_amount)} · Vencimento: {sub?.due_date||'Não definido'}</p><p>Controle administrativo: nenhuma cobrança Pix é gerada automaticamente nesta versão.</p>"""
new="""<div className="panel"><span className="eyebrow">PLANO ÚNICO PITACCO</span><h3>Assinatura de {active.name}</h3><p style={{fontSize:'1.8rem',fontWeight:800,margin:'8px 0'}}>R$ 59,90 <small style={{fontSize:'0.85rem',fontWeight:400}}>por mês / estabelecimento</small></p><p>7 dias de teste grátis para cada estabelecimento, uma única vez. Pedidos e entregadores ilimitados.</p><div className="line"><b>Situação</b><span>{sub?.status||'Ainda não ativada'}</span></div><div className="line"><b>Próximo vencimento</b><span>{sub?.due_date||'A definir'}</span></div><div className="line"><b>Valor registrado</b><span>{money(sub?.monthly_amount??59.90)}</span></div><p className="hint">Pagamento confirmado, período de teste e bloqueios devem ser validados pelo backend. Nenhuma cobrança Pix ou reativação automática é simulada nesta versão.</p>"""
assert s.count(old)==1,"subscription block changed"
s=s.replace(old,new,1)
old="defaultValue={sub?.monthly_amount||99}"
assert s.count(old)==1
s=s.replace(old,"defaultValue={sub?.monthly_amount??59.90}",1)
p.write_text(s,encoding='utf-8')
