"""Restore Fiado navigation after the legacy menu rewrites; no financial data changes."""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
def change(old,new):
 global s
 assert s.count(old)==1, f'Fiado navigation anchor changed: {old[:100]}'
 s=s.replace(old,new,1)
change("['Financeiro',Wallet,'Principal']", "['Financeiro',Wallet,'Principal'],['Fiado / Caderneta',Wallet,'Principal']")
change('nav.filter(([name])=>allowed(name))','nav.filter(([name])=>allowed(name)&&(name!==\'Fiado / Caderneta\'||manager&&!!active))')
# Keep the existing view and tenant-scoped manager check, with a stable reload URL.
assert "const merchantTabs=new Set([" in s
assert "active&&!isDriver&&manager&&tab==='Fiado / Caderneta'&&<FiadoCaderneta" in s
p.write_text(s,encoding='utf-8')
