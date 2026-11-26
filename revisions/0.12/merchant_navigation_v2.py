"""Final navigation overlay; retain legacy routes and all existing operational components."""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
def change(old,new):
 global s
 assert s.count(old)==1, f'Navigation anchor changed: {old[:110]} ({s.count(old)})'
 s=s.replace(old,new,1)
s="import {MerchantNavigation,MerchantMobileBar} from './MerchantNavigation.jsx';\nimport {menuRouteIds,resolveMenuRoute,fallbackMenuItems,menuAllowed} from './merchantNavigation.mjs';\nimport NavigationFleetTracking from './FleetTracking.jsx';\nimport IncidentCenter from './IncidentCenter.jsx';\n"+s
change("const merchantTabs=new Set([","const merchantTabs=new Set([...menuRouteIds,")
change("const target=Object.hasOwn(landing,saved)?landing[saved]:saved;","const target=menuRouteIds.includes(saved)?saved:Object.hasOwn(landing,saved)?landing[saved]:saved;")
change("[tab,setTab]=useState(()=>nativeAvailable()?'Pedidos':readMerchantTab()),","")
change("function App(){","""function App(){
 const [navigationRoute,setNavigationRoute]=useState(()=>nativeAvailable()?'Pedidos':readMerchantTab());
 const [navigationKey,bumpNavigationKey]=useState(0);\n const [incidentCount,setIncidentCount]=useState(0);
 const [menuCollapsed,setMenuCollapsed]=useState(()=>{try{return localStorage.getItem('pitacco-menu-collapsed')==='1'}catch{return false}});
 const route=resolveMenuRoute(navigationRoute),tab=route.section==='occurrences'?'Ocorrências':route.tab;
 const setTab=React.useCallback(next=>{setNavigationRoute(next);bumpNavigationKey(n=>n+1)},[]);
 function toggleMenu(){setMenuCollapsed(old=>{try{localStorage.setItem('pitacco-menu-collapsed',old?'0':'1')}catch{}return !old})}
""")
change("if(tab==='Painel')location.searchParams.delete('aba');","if(navigationRoute==='Painel')location.searchParams.delete('aba');")
change("else if(merchantTabs.has(tab))location.searchParams.set('aba',tab);","else if(merchantTabs.has(navigationRoute))location.searchParams.set('aba',navigationRoute);")
change("},[tab]);\nuseEffect(()=>{if(featureSettings&&!allowed(tab))setTab('Painel')},[tab,featureSettings]);","},[navigationRoute]);\nuseEffect(()=>{if(featureSettings&&(!allowed(route.tab)||(route.feature&&featureSettings[route.feature]===false)))setTab('Painel')},[tab,navigationRoute,featureSettings]);")
# Preserve the original header, session, theme, logout and background subscription.
start=s.index('<nav aria-label="Menu principal">')
end=s.index('</nav>',start)+len('</nav>')
s=s[:start]+"""<MerchantNavigation client={supabase} storeLogoUrl={storeBrand?.store_id===selected?storeBrand.logo_url:(active?.logo_path&&active.logo_path.startsWith('stores/'+selected+'/')?supabase.storage.from('pitacco-media').getPublicUrl(active.logo_path).data.publicUrl:'')} routeId={navigationRoute} onNavigate={target=>{setTab(target);setMessage('');setMobileMenuOpen(false)}} allowed={allowed} manager={manager} active={active} admin={admin} driver={isDriver} featureSettings={featureSettings} stores={stores} selected={selected} onStoreChange={setSelected} userId={session.user.id} theme={theme} onThemeChange={setTheme} email={profile?.email||session.user.email} role={profile?.role} version={nativeAvailable()?'Pitacco Windows v0.12.34':''} native={nativeAvailable()} onLogout={()=>supabase.auth.signOut()} incidentCount={incidentCount} extra={fallbackMenuItems(nav,secondaryTabs,landing)} collapsed={menuCollapsed} onCollapse={toggleMenu}/>"""+s[end:]
# Add the collapse state to the merchant shell without depending on earlier layout class additions.
import re
shell=list(re.finditer(r'<div className=\{([^{}\n]*pitacco-mobile-workspace[^{}\n]*)\}>',s))
assert len(shell)==1, 'Merchant shell class not found'
m=shell[0]
s=s[:m.start()]+ '<div className={'+m.group(1)+'+(menuCollapsed?" mn-sidebar-collapsed":"")}>'+s[m.end():]
change('<header className="pitacco-mobile-top">','<header className={"pitacco-mobile-top"+(isDriver?" mn-driver-top":" mn-redundant-top")}>')
change('</main>',"""</main>{!nativeAvailable()&&<MerchantMobileBar routeId={navigationRoute} onNavigate={target=>{setTab(target);setMessage('');setMobileMenuOpen(false)}} onMore={()=>setMobileMenuOpen(open=>!open)} menuOpen={mobileMenuOpen} allowed={allowed} manager={manager} active={active} admin={admin} driver={isDriver} featureSettings={featureSettings}/>}""")
# Mount the incident center before the workspace content, not below all deliveries.
change("{active&&<StorefrontShare", """{active&&!isDriver&&manager&&allowed('Entregas')&&<IncidentCenter key={selected} client={supabase} storeId={selected} visible={route.section==='occurrences'} showShortcut={tab==='Entregas'||tab==='Ocorrências'} onCount={setIncidentCount} onOpen={()=>{setTab(route.section==='occurrences'?'Entregas':'Ocorrências');window.scrollTo(0,0);document.querySelector('.app>main')?.scrollTo(0,0)}} orders={orders} deliveries={deliveries}/>}\n{active&&<StorefrontShare""")
# Existing views are not remounted unnecessarily; direct section props only change when selected.
change('<MenuStudio client={supabase} storeId={selected}',"<MenuStudio initialSection={route.section||'Produtos'} navigationKey={navigationKey} client={supabase} storeId={selected}")
change('<FinancialReport key={selected} client={supabase} store={active}/>','<FinancialReport key={selected} client={supabase} store={active} initialView={route.section||\'report\'} navigationKey={navigationKey}/>')
change('<FiadoCaderneta key={selected} client={supabase} storeId={selected} onNavigate={setTab}/>','<FiadoCaderneta key={selected} client={supabase} storeId={selected} onNavigate={setTab} initialTab={route.section||\'clientes\'} navigationKey={navigationKey}/>')
change('<CourierWorkspace client={supabase} store={active}',"<CourierWorkspace initialTab={route.section||'Entregadores'} navigationKey={navigationKey} client={supabase} store={active}")
change('<Operations key={selected} client={supabase}',"<Operations navigationSection={route.section} navigationKey={navigationKey} key={selected} client={supabase}")
change("function CustomersFromOrders({orders=[],storeId})","function CustomersFromOrders({orders=[],storeId,blockedOnly=false})")
change(" const list=[...customers.values()].sort"," if(blockedOnly)for(const phone of Object.keys(blocks)){if(blocks[phone]&&!customers.has('phone:'+phone))customers.set('phone:'+phone,{name:'Telefone bloqueado',phone,count:0,total:0,last:''})}\n const list=[...customers.values()].filter(c=>!blockedOnly||!!blocks[c.phone]).sort")
change('<CustomersFromOrders orders={orders} storeId={selected}/>','<CustomersFromOrders key={navigationRoute} orders={orders} storeId={selected} blockedOnly={route.section===\'bloqueados\'}/>')
change('<h3>Clientes e histórico de pedidos</h3>','<h3>{blockedOnly?\'Clientes bloqueados\':\'Clientes e histórico de pedidos\'}</h3>')
change("{active&&!isDriver&&manager&&tab==='Fiado / Caderneta'", "{active&&!isDriver&&manager&&tab==='Mapa de entregadores'&&<NavigationFleetTracking key={selected} client={supabase} storeId={selected} onBack={()=>setTab('Entregas')}/>}\n{active&&!isDriver&&manager&&tab==='Fiado / Caderneta'")
# Desktop import uses the same web-based editor, without a separate implementation.
change("tab==='Importar cardápio'&&active&&!nativeAvailable()&&!isDriver","tab==='Importar cardápio'&&active&&!isDriver")
# Driver navigation and manager guards remain intact. The active alias is used by the module gate.
p.write_text(s,encoding='utf-8')
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
change("storeLogoPath=''})","storeLogoPath='',navigationSection='',navigationKey})")
# The compact Windows information strip is only for the live browser order board.
change("{manager&&!desktop&&view==='Pedidos'&&<WindowsConnectionStatus","{manager&&!desktop&&view==='Pedidos'&&navigationSection!=='history'&&<WindowsConnectionStatus")
# Do not remount Operations or reset orders, print jobs, subscriptions or sound on navigation.
needle=" const [orderBadges,setOrderBadges]"
assert s.count(needle)==1
s=s.replace(needle," useEffect(()=>{if(view==='Configurações'&&['Impressoras','Aceite de pedidos','Alertas e aplicativo'].includes(navigationSection))setSettingsTab(navigationSection)},[view,navigationSection,navigationKey]);\n"+needle,1)
change('<Fideliza client={client} storeId={storeId} manager={manager}/>','<Fideliza client={client} storeId={storeId} manager={manager} initialSection={navigationSection||\'Visão geral\'} navigationKey={navigationKey}/>')
p.write_text(s,encoding='utf-8')

# Dedicated catalog-backed sale screen; the existing manual form remains available in Kitchen.
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
s="import MerchantNewOrder from './MerchantNewOrder.jsx';\n"+s
change("{manager&&view==='Cozinha e expedição'&&<>","{manager&&view==='Cozinha e expedição'&&navigationSection==='new-order'&&<MerchantNewOrder key={storeId} client={client} storeId={storeId} onNavigate={onNavigate}/>}\n {manager&&view==='Cozinha e expedição'&&navigationSection!=='new-order'&&<>")
p.write_text(s,encoding='utf-8')

# Dedicated, read-only history route; keep the operational feed mounted for alerts.
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
s="import OrderHistory from './OrderHistory.jsx';\n"+s
change("{manager&&view==='Pedidos'&&<Pedidos", "{manager&&view==='Pedidos'&&navigationSection==='history'&&<OrderHistory key={storeId} client={client} storeId={storeId}/>}\n {manager&&view==='Pedidos'&&navigationSection!=='history'&&<Pedidos")
p.write_text(s,encoding='utf-8')
