import React,{useEffect,useState} from 'react';
import {LayoutDashboard,ShoppingBag,Utensils,Bike,Users,Gift,Wallet,Plug,Settings,Headphones,ChevronDown,ChevronRight,ChevronsUpDown,PanelLeftClose,PanelLeftOpen,Search,Star,Store,Menu,LogOut,UserCircle,Sun,Moon} from 'lucide-react';
import {groups,overview,support,resolveMenuRoute,menuAllowed,searchMenu} from './merchantNavigation.mjs';
import './merchant-navigation.css';
import OperationalShortcuts from './OperationalShortcuts.jsx';
import {CommercialBillingNotice} from './BillingStatus.jsx';
const icons={operation:ShoppingBag,menu:Utensils,delivery:Bike,customers:Users,loyalty:Gift,finance:Wallet,integrations:Plug,settings:Settings};
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}};
const write=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value))}catch{}};
export function MerchantNavigation({routeId,onNavigate,allowed,manager,active,admin,driver,featureSettings,stores,selected,onStoreChange,userId,extra=[],collapsed,onCollapse,theme='light',onThemeChange,email,role,version,onLogout,incidentCount=0,native=false,client}){
 const key='pitacco-navigation:'+String(userId||'local')+':'+String(selected||'none');
 const [query,setQuery]=useState(''),[open,setOpen]=useState([]),[favorites,setFavorites]=useState([]),[accountOpen,setAccountOpen]=useState(false);
 const [smallScreen,setSmallScreen]=useState(()=>typeof window!=='undefined'&&window.matchMedia('(max-width:800px)').matches);
 useEffect(()=>{const media=window.matchMedia('(max-width:800px)');const update=()=>setSmallScreen(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[]);
 collapsed=collapsed&&!smallScreen;
 const current=resolveMenuRoute(routeId);
 const context={allowed,manager,active,admin,driver,featureSettings};
 const usable=r=>menuAllowed(r,context);
 const actualGroups=[...groups,...(extra.length?[{name:'Outras funções',icon:'settings',items:extra}]:[])];
 const all=actualGroups.flatMap(g=>g.items);
 useEffect(()=>{setFavorites(read(key+':favorites',[]));setOpen([]);setQuery('');setAccountOpen(false)},[key]);
 const toggle=name=>setOpen(old=>old.includes(name)?old.filter(n=>n!==name):[...old,name]);
 function favorite(id){setFavorites(old=>{const next=old.includes(id)?old.filter(x=>x!==id):[...old,id];write(key+':favorites',next);return next})}
 function go(id){setQuery('');onNavigate(id)}
 const render=(r,Icon=null,compact=false)=> <div className={'mn-item'+(current.id===r.id?' mn-active':'')} key={r.id}><button type="button" className="mn-link" aria-current={current.id===r.id?'page':undefined} title={r.label} aria-label={r.id==='Configurações'?'Configurar impressão e visualizar nota':r.label} onClick={()=>go(r.id)}>{Icon?<Icon size={19}/>:<span className="mn-dot"/>}<span>{r.label}</span>{r.id==='Ocorrências'&&incidentCount>0&&<b className="mn-incident-count">{incidentCount}</b>}</button>{!compact&&<button type="button" className={'mn-star'+(favorites.includes(r.id)?' is-favorite':'')} aria-label={(favorites.includes(r.id)?'Remover favorito: ':'Fixar favorito: ')+r.label} aria-pressed={favorites.includes(r.id)} onClick={()=>favorite(r.id)}><Star size={15}/></button>}</div>;
 if(driver)return <nav aria-label="Menu principal" className="merchant-nav">{render(resolveMenuRoute('Entregas'),Bike,true)}</nav>;
 return <nav aria-label="Menu principal" className={'merchant-nav mn-compact'+(collapsed?' mn-collapsed':'')}>
 <div className="mn-top"><span className="mn-logo"><img src="/pitacco-brand-013.svg" alt="Pitacco"/></span><button type="button" className="mn-collapse" aria-label={collapsed?'Expandir menu':'Recolher menu'} onClick={onCollapse}>{collapsed?<PanelLeftOpen size={19}/>:<PanelLeftClose size={19}/>}</button></div>
 <div className="mn-store"><Store size={22}/><div><span>Estabelecimento</span><select aria-label="Trocar estabelecimento" value={selected||''} onChange={e=>onStoreChange(e.target.value)}>{!selected&&<option value="">{stores.length?(native?"Selecione a loja deste computador":"Selecione a loja"):"Nenhuma loja vinculada"}</option>}{stores.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></div><ChevronsUpDown size={15}/></div>
 {active&&manager&&client&&!collapsed&&<CommercialBillingNotice key={'billing-'+selected} client={client} storeId={selected} onRegularize={()=>go('Assinaturas')}/>}
 {active&&manager&&client&&<OperationalShortcuts key={selected} client={client} storeId={selected} native={native} collapsed={collapsed} onExpand={onCollapse} canCreate={usable(resolveMenuRoute('Novo Pedido'))} canAccept={allowed('Configurações')} canDispatch={allowed('Entregas')} onNewOrder={()=>go('Novo Pedido')}/>}
 <label className="mn-search"><Search size={17}/><input type="search" aria-label="Buscar funcionalidades" placeholder="Buscar funcionalidades" value={query} onChange={e=>{setQuery(e.target.value);if(collapsed)onCollapse()}}/></label>
 {usable(overview)&&(!query||searchMenu(overview,query))&&render(overview,LayoutDashboard,true)}
 {!query&&favorites.some(id=>all.some(r=>r.id===id&&usable(r)))&&<div className="mn-favorites"><small>Favoritos</small>{favorites.map(id=>all.find(r=>r.id===id)).filter(r=>r&&usable(r)).map(r=>render(r,Star))}</div>}
 {actualGroups.map(g=>{const visible=g.items.filter(r=>usable(r)&&(!query||searchMenu(r,query)||searchMenu({label:g.name,id:g.name,tab:g.name},query)));if(!visible.length&&!(g.name==='Configurações'&&(!query||searchMenu({label:'Aparência do painel',id:'Claro Escuro',tab:'Configurações'},query))))return null;
  const Icon=icons[g.icon]||Settings,expanded=!!query||open.includes(g.name),containsCurrent=g.items.some(r=>r.id===routeId);
  return <div key={g.name} className="mn-group"><button type="button" className={'mn-group-button'+(expanded?' mn-expanded':'')+(containsCurrent?' mn-current-group':'')} title={g.name} aria-expanded={expanded&&!collapsed} onClick={()=>{if(collapsed){onCollapse();setOpen(old=>old.includes(g.name)?old:[...old,g.name])}else toggle(g.name)}}><Icon size={19}/><span>{g.name}</span>{g.name==='Entregas'&&incidentCount>0&&<b className="mn-incident-count">{incidentCount}</b>}{expanded?<ChevronDown size={15}/>:<ChevronRight size={15}/>}</button>{expanded&&!collapsed&&<div className="mn-submenu">{visible.map(r=>render(r))}{g.name==='Configurações'&&(!query||searchMenu({label:'Aparência do painel',id:'Claro Escuro',tab:'Configurações'},query))&&<div className="mn-theme"><span>Aparência do painel</span><div role="group" aria-label="Modo de aparência"><button type="button" aria-pressed={theme==='light'} onClick={()=>onThemeChange?.('light')}><Sun size={15}/> Claro</button><button type="button" aria-pressed={theme==='dark'} onClick={()=>onThemeChange?.('dark')}><Moon size={15}/> Escuro</button></div></div>}</div>}</div>})}
 {query&&!actualGroups.some(g=>g.items.some(r=>usable(r)&&(searchMenu(r,query)||searchMenu({label:g.name,id:g.name,tab:g.name},query))))&&!searchMenu(overview,query)&&<small className="mn-empty">Nenhuma função encontrada.</small>}
 <div className="mn-support">{usable(support)&&(!query||searchMenu(support,query))&&render(support,Headphones,true)}{!query&&<><button type="button" className="mn-group-button mn-account-button" title="Minha conta" aria-expanded={accountOpen&&!collapsed} onClick={()=>{if(collapsed){onCollapse();setAccountOpen(true)}else setAccountOpen(!accountOpen)}}><UserCircle size={19}/><span>Minha conta</span>{accountOpen?<ChevronDown size={15}/>:<ChevronRight size={15}/>}</button>{accountOpen&&!collapsed&&<div className="mn-account-panel"><small>{email}</small><small>{role}</small>{version&&<small>{version}</small>}<button type="button" className="mn-link" onClick={onLogout}><LogOut size={16}/><span>Sair</span></button></div>}</>}</div>
 </nav>;
}
export function MerchantMobileBar({routeId,onNavigate,onMore,menuOpen=false,allowed,manager,active,admin,driver,featureSettings}){
 if(driver)return null;
 const ctx={allowed,manager,active,admin,driver,featureSettings};
 const items=[['Painel','Início',LayoutDashboard],['Pedidos','Pedidos',ShoppingBag],['Entregas','Entregas',Bike],['Caixa','Caixa',Wallet]].filter(([id])=>menuAllowed(resolveMenuRoute(id),ctx));
 return <nav aria-label="Atalhos do celular" className="mn-mobile-bar">{items.map(([id,label,Icon])=><button type="button" key={id} aria-current={resolveMenuRoute(routeId).tab===id?'page':undefined} onClick={()=>onNavigate(id)}><Icon size={21}/><span>{label}</span></button>)}<button type="button" aria-controls="pitacco-store-navigation" aria-expanded={menuOpen} className={menuOpen?'mn-more-open':undefined} onClick={onMore}><Menu size={21}/><span>Mais</span></button></nav>;
}
