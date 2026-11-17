"""Make Windows navigation verifiable and expose printing from any screen.

The native process intentionally keeps the order/print subscriber mounted when
the shop changes screens: do not unmount Operations or reset its print queue.
"""
from pathlib import Path

app=Path('web/src.jsx')
text=app.read_text(encoding='utf-8')

def replace_once(old,new,label):
 global text
 found=text.count(old)
 assert found==1, f'{label}: expected 1 match, got {found}'
 text=text.replace(old,new,1)

# Never hide 'Applications & Downloads' just because the Tauri bridge is active.
replace_once(
 "{!nativeAvailable()&&active&&!isDriver&&tab==='Aplicativos e Downloads'&&<AppDownloads client={supabase}/>}","{active&&!isDriver&&tab==='Aplicativos e Downloads'&&<AppDownloads client={supabase}/>}","downloads available in Windows"
)

# Set the currently installed version apart from the web interface.
replace_once(
 '<small className="account">{profile?.email} · {profile?.role||\'carregando\'}</small>',
 '<small className="account">{profile?.email} · {profile?.role||\'carregando\'}{nativeAvailable()&&<><span className="pitacco-version">Pitacco Windows v0.12.6</span></>}</small>',
 'desktop version badge'
)

# Offer the printing panel as a top-level destination. It cannot be buried
# behind the 'Administrar Loja' submenu or depend on its visibility state.
replace_once(
 '</nav><div className="theme-switch">',
 '''{nativeAvailable()&&active&&!isDriver&&<button type="button"
  aria-label="Configurar impressão e visualizar nota"
  className={tab==='Configurações'?'active':''}
  onClick={()=>{setTab('Configurações');setMessage('')}}>
  <Printer size={18}/> Impressão e aceite
 </button>}</nav><div className="theme-switch">''',
 'direct printing navigation'
)

# Every management group has native submenus, without removing existing tools.
replace_once(
 "'Financeiro':[]};",
 "'Motoboys':[['Entregadores','Motoboys e entregas'],['Relatório de motoboys','Relatórios'],['Pagamento de motoboys','Pagamentos']],"
 "'Financeiro':[['Lançamentos','Lançamentos'],['Despesas','Despesas'],['Assinaturas','Assinatura']]};",
 'navigation submenu destinations'
)

# Do not accidentally hide empty content on a render failure: make it visible
# and retryable. The subscriber continues running behind its own boundary.
replace_once(
 "hiddenOnError={!['Pedidos','Cozinha e expedição','Configurações','Fideliza+'].includes(tab)}",
 "hiddenOnError={false}",
 'visible diagnostics for background subscriber failures'
)

app.write_text(text,encoding='utf-8')

# The boundary handles component errors without disclosing sensitive database data.
# Keep the main menu functional so that a failure in one module can be bypassed.
boundary=Path('web/WorkspaceBoundary.jsx')
source=boundary.read_text(encoding='utf-8')
assert source.count('state={failed:false};')==1
source=source.replace('state={failed:false};','state={failed:false};',1)
assert source.count('<p role="alert">Não foi possível abrir esta tela do painel.</p>')==1
source=source.replace('<p role="alert">Não foi possível abrir esta tela do painel.</p>',
 '<p role="alert">Não foi possível abrir esta tela. Pedidos e fila de impressão permanecem preservados. Tente novamente ou escolha outro módulo no menu.</p>',1)
boundary.write_text(source,encoding='utf-8')

style=Path('web/style.css')
style.write_text(style.read_text(encoding='utf-8')+
 "\n/* Windows: visible installed build identification; no web layout changes. */\n"
 ".pitacco-version{display:block;margin-top:10px;font-size:12px;font-weight:700;color:inherit;}\n",
 encoding='utf-8')
print('Windows: direct printing, visible build, native submenus and module fallback verified.')
