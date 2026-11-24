"""Improve subscription presentation without changing payment authorization or billing backend."""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
old="""<div className="panel"><h3>Assinatura de {active.name}</h3><p>Status: <b>{sub?.status||'Não cadastrada'}</b> · Mensalidade: {money(sub?.monthly_amount)} · Vencimento: {sub?.due_date||'Não definido'}</p><p>Controle administrativo: nenhuma cobrança Pix é gerada automaticamente nesta versão.</p>"""
new="""<div className="panel"><span className="eyebrow">MINHA ASSINATURA</span><h3>Assinatura de {active.name}</h3><p>Consulte sua situação e os dados confirmados pelo sistema de cobrança.</p><BillingStatus key={selected} client={supabase} storeId={selected}/>"""
assert s.count(old)==1,"subscription block changed"
s=s.replace(old,new,1)
old="defaultValue={sub?.monthly_amount||99}"
assert s.count(old)==1
s=s.replace(old,"defaultValue={sub?.monthly_amount??59.90}",1)
p.write_text(s,encoding='utf-8')
