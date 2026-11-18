"""Pitacco Windows v0.12.10 — keep Pedidos focused on order cards only.

Runs after the Windows alert/audio overlays so old settings cannot reappear.
The order/push/print subscriber remains mounted; this changes presentation only.
"""
from pathlib import Path

p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')

def once(old,new,label):
 global s
 count=s.count(old)
 assert count==1,f'{label}: expected one anchor, found {count}'
 s=s.replace(old,new,1)

# The approved voice, the five bell choices and volume sliders must live
# exclusively in Configurações > Alertas e aplicativo.
once(
 "{manager&&desktop&&['Painel','Pedidos','Configurações','Alertas'].includes(view)&&",
 "{manager&&desktop&&view==='Configurações'&&settingsTab==='Alertas e aplicativo'&&",
 'audio settings must not be displayed with orders'
)

# An older intake overlay also injected a separate bell test and volume
# selector directly on Pedidos; leave the browser-only toggle untouched.
start_token="{manager&&['Painel','Pedidos'].includes(view)&&(desktop?<div className=\"dispatch-actions\">"
end_token="</div>:soundControl)}"
assert s.count(start_token)==1 and s.count(end_token)==1,'Legacy order sound controls changed'
start=s.index(start_token)
end=s.index(end_token,start)+len(end_token)
s=s[:start]+"{manager&&!desktop&&['Painel','Pedidos'].includes(view)&&soundControl}"+s[end:]

# Pedidos already mounts the approved <Pedidos/> component, with the
# five-step order cards. The redundant desktop operational summary (including
# printer settings/indicators) must not appear above the cards.
lines=s.splitlines(keepends=True)
summaries=[i for i,line in enumerate(lines) if "{manager&&desktop&&view==='Pedidos'&&<div className=\"operational-overview\"" in line]
assert len(summaries)==1,'Redundant Windows order summary changed'
lines.pop(summaries[0])
s=''.join(lines)

# Connection diagnostics belong to Configurações, not over the cards.
connection='<div className="connection-bar"><span className="status-dot"/>{status}<span className="badge neutral">{desktop?\'Aplicativo Windows\':\'Painel web\'}</span></div>'
once(connection,"{!(desktop&&view==='Pedidos')&&"+connection+"}",'operation connection bar')

# Keep error messages on Pedidos, since hiding a failed synchronization
# would be dangerous. Keep printing/reprint and status progression on cards.
assert "{manager&&view==='Pedidos'&&<Pedidos " in s
assert "onReady=" in s and "onConclude=" in s and "onReprint=" in s
assert "view==='Configurações'&&settingsTab==='Alertas e aplicativo'" in s
assert "{manager&&desktop&&view==='Pedidos'&&<div className=\"operational-overview\"" not in s
assert "desktop?<div className=\"dispatch-actions\">" not in s
p.write_text(s,encoding='utf-8')

# The installed build number is displayed under the Windows account label.
app=Path('web/src.jsx')
ui=app.read_text(encoding='utf-8')
assert ui.count('Pitacco Windows v0.12.9')==1,'Windows version label changed'
ui=ui.replace('Pitacco Windows v0.12.9','Pitacco Windows v0.12.10',1)
app.write_text(ui,encoding='utf-8')
print('Pitacco Windows v0.12.10: Pedidos shows only the order workspace and cards; sound/printer settings remain in Configurações.')
