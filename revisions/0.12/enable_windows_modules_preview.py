"""Restore complete merchant navigation on Windows and the approved thermal preview.

Apply *after* all other 0.12 overlays, so no earlier Windows-only restriction
can silently redirect the user back to the Pedidos page. Reuses the same module
components and tenant permissions as the website.
"""
from pathlib import Path

app = Path("web/src.jsx")
s = app.read_text(encoding="utf-8")

def replace_once(old, new, label):
    global s
    count = s.count(old)
    assert count == 1, f"{label}: source changed ({count} matches)"
    s = s.replace(old, new, 1)

replace_once(
    "useEffect(()=>{if(nativeAvailable()&&!desktopOperationalTabs.has(tab))setTab('Pedidos')},[tab]);",
    "",
    "remove the forced return to Pedidos"
)
replace_once(
    "const desktopOperationalTabs=new Set(['Pedidos','Cozinha e expedição','Configurações']);",
    "",
    "remove restricted Windows menu"
)
replace_once(
    ".filter(([name])=>!nativeAvailable()||['Visão Geral','Pedidos','Motoboys','Caixa','Administrar Loja','Financeiro','Fideliza+','Clientes','Atualizações'].includes(name))",
    "",
    "show all authorized merchant modules in Windows"
)
replace_once(
    ".filter(([target])=>!nativeAvailable()||['Configurações','Entregadores','Relatório de motoboys','Pagamento de motoboys','Assinaturas','Lançamentos','Despesas'].includes(target))",
    "",
    "show all authorized settings submenus in Windows"
)
replace_once(
    "&&secondaryTabs[name]&&!isDriver&&!['Financeiro','Motoboys','Administrar Loja'].includes(name)",
    "&&secondaryTabs[name]&&!isDriver&&(nativeAvailable()||!['Financeiro','Motoboys','Administrar Loja'].includes(name))",
    "enable native submenus without changing web behavior"
)

for old,new,label in [
    ("active&&!isDriver&&!nativeAvailable()&&tab==='Alertas'", "active&&!isDriver&&tab==='Alertas'", "alerts"),
    ("active&&!isDriver&&!nativeAvailable()&&tab==='Relatórios'", "active&&!isDriver&&tab==='Relatórios'", "reports"),
    ("active&&!isDriver&&!nativeAvailable()&&tab==='Estoque'", "active&&!isDriver&&tab==='Estoque'", "inventory"),
    ("{manager&&!nativeAvailable()&&<>", "{manager&&<>", "merchant settings links"),
    ("{manager&&!nativeAvailable()&&allowed('Agendamento')", "{manager&&allowed('Agendamento')", "scheduled orders link"),
    ("{tab==='Agendamento'&&active&&manager&&!nativeAvailable()", "{tab==='Agendamento'&&active&&manager", "scheduled orders"),
    ("{tab==='Primeiros passos'&&active&&!nativeAvailable()", "{tab==='Primeiros passos'&&active", "onboarding"),
    ("{tab==='Horário de funcionamento'&&active&&!nativeAvailable()", "{tab==='Horário de funcionamento'&&active", "opening hours"),
    ("{tab==='Aparência do cardápio'&&active&&!nativeAvailable()", "{tab==='Aparência do cardápio'&&active", "storefront design"),
    ("{tab==='Ajuda e suporte'&&active&&!nativeAvailable()", "{tab==='Ajuda e suporte'&&active", "support"),
    ("{active&&!nativeAvailable()&&['Área de entrega','Pagamentos da loja'].includes(tab)", "{active&&['Área de entrega','Pagamentos da loja'].includes(tab)", "store delivery and payments"),
    ("{!nativeAvailable()&&active&&!isDriver&&<button type=\"button\" className={tab==='Aplicativos e Downloads'", "{active&&!isDriver&&<button type=\"button\" className={tab==='Aplicativos e Downloads'", "downloads"),
]:
    replace_once(old, new, label)

# Feature flags, tenant authorizations and driver-only menu rules remain in place.
replace_once(
    "<Operations key={selected} client={supabase} storeId={selected} manager={manager} view={tab} onNavigate={setTab}/>",
    "<Operations key={selected} client={supabase} storeId={selected} storeName={active?.name||''} manager={manager} view={tab} onNavigate={setTab}/>",
    "pass store name to the actual print preview"
)
app.write_text(s, encoding="utf-8")

operations = Path("web/Operations.jsx")
s = operations.read_text(encoding="utf-8")
assert "import WindowsReceiptPreview from './WindowsReceiptPreview.jsx';" not in s
s = "import WindowsReceiptPreview from './WindowsReceiptPreview.jsx';\n" + s
old = "export default function Operations({client,storeId,manager,view,onNavigate}){"
assert s.count(old) == 1, "Operations signature changed"
s = s.replace(old, "export default function Operations({client,storeId,manager,view,onNavigate,storeName=''}){", 1)

start = s.index('   <div className="panel"><h3>Conteúdo da comanda</h3>')
end = s.index("   {desktop&&jobs.some(",start)
s = s[:start] + """   <WindowsReceiptPreview key={storeId} storeId={storeId} storeName={storeName} initialWidth={Number(sectors[0]?.width)===58?58:80}/>
""" + s[end:]
operations.write_text(s,encoding="utf-8")
print("Windows: all authorized modules are accessible; thermal preview restored.")
