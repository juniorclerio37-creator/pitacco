"""The signed Windows update now has its own action in MerchantNavigation."""
from pathlib import Path
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
old="""<button className="secondary" disabled={busy} onClick={()=>act(async()=>{const result=await invoke('check_update');setStatus(String(result||'Verificação concluída.'))})}>Verificar atualização assinada</button>"""
assert s.count(old)==1, 'Legacy update button changed'
s=s.replace(old,'',1)
p.write_text(s,encoding='utf-8')
