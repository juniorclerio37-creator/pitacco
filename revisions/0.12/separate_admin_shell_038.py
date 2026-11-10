"""Separate platform-owner desktop shell from tenant operations while keeping one installer."""
from pathlib import Path
p=Path('web/src.jsx');s=p.read_text(encoding='utf-8')
# Reset workspace when the authenticated identity changes, avoiding role-view leakage.
needle="useEffect(()=>{if(!supabase)"
assert s.count(needle)==1
s=s.replace(needle,"useEffect(()=>{setPlatformWorkspace(true)},[session?.user?.id]);\n"+needle,1)
needle="function App(){const[storeBrand"
assert s.count(needle)==1
s=s.replace(needle,"function App(){const [platformWorkspace,setPlatformWorkspace]=useState(true);const[storeBrand",1)
needle="return <div className=\"app\"><aside>"
assert s.count(needle)==1
admin_shell="""if(admin&&platformWorkspace){
 const adminPages=[['Painel geral',LayoutDashboard],['Estabelecimentos',Store],['Assinaturas',CreditCard],['Atualizações',Settings]];
 const current=adminPages.some(([name])=>name===tab)?tab:'Painel geral';
 return <div className="app pitacco-admin-shell"><aside><div className="brand pitacco-platform-brand"><img src="/pitacco-brand-013.svg" alt="Pitacco"/><span><strong>Pitacco Admin</strong><small>Administração da plataforma</small></span></div><nav aria-label="Administração geral">{adminPages.map(([name,Icon])=><button key={name} className={current===name?'active':''} onClick={()=>{setTab(name);setMessage('')}}><Icon size={18}/>{name}</button>)}</nav><small className="account">{profile?.email} · Administração geral</small><button className="logout" onClick={()=>supabase.auth.signOut()}><LogOut size={16}/> Sair</button></aside><main className="pitacco-workspace pitacco-workspace--admin"><header><div><span className="eyebrow">PITACCO · ADMINISTRAÇÃO</span><h2>{current}</h2><p>Ambiente exclusivo da administração da plataforma.</p></div><button className="secondary" onClick={()=>{setPlatformWorkspace(false);setTab('Painel')}}>Entrar no ambiente da loja</button></header>{message&&<div className="notice" role="status">{message}</div>}{current==='Painel geral'&&<><section className="metrics"><article><span>Lojas acessíveis</span><strong>{stores.length}</strong></article><article><span>Contas vinculadas</span><strong>{members.length}</strong></article></section><div className="panel"><h3>Administração centralizada</h3><p>Gerencie os estabelecimentos, assinaturas e atualizações sem misturar essas ferramentas com a operação diária das lojas.</p></div></>}{current==='Estabelecimentos'&&<div className="panel"><h3>Estabelecimentos</h3><p>Para cadastrar e configurar estabelecimentos, acesse o ambiente da loja e escolha Administrar Loja → Estabelecimentos.</p><button onClick={()=>{setPlatformWorkspace(false);setTab('Lojas')}}>Gerenciar estabelecimentos</button></div>}{current==='Assinaturas'&&<div className="panel"><h3>Assinaturas</h3><p>Consulte as assinaturas vinculadas aos estabelecimentos na área Financeiro. O painel global de cobrança será liberado após validação das permissões no backend.</p><button onClick={()=>{setPlatformWorkspace(false);setTab('Assinaturas')}}>Abrir assinaturas</button></div>}{current==='Atualizações'&&<section className="release-center"><div className="panel"><h3>Central de atualizações</h3><p>O instalador Windows será o mesmo para administradores e lojistas. Apenas a administração geral poderá controlar a publicação e a distribuição de versões assinadas.</p><p>Publicação e instalação automática permanecem desativadas até a configuração e validação do Tauri Updater.</p><a href="https://github.com/juniorclerio37-creator/pitacco/releases" target="_blank" rel="noopener noreferrer">Consultar versões publicadas</a></div></section>}</main></div>;
}
"""
s=s.replace(needle,admin_shell+needle,1)
needle="<main className={'pitacco-workspace"
assert s.count(needle)==1
s=s.replace(needle,"<main className={'pitacco-workspace",1)
# The admin shell has its own header; target only the tenant header after its return.
needle="<header><div><span className=\"eyebrow\""
assert s.count(needle)==2
# Last occurrence belongs to the store workspace.
head,tail=s.rsplit(needle,1)
s=head+"<header>{admin&&<button className=\"secondary admin-return\" onClick={()=>{setPlatformWorkspace(true);setTab('Painel geral')}}>Voltar ao Pitacco Admin</button>}<div><span className=\"eyebrow\""+tail
p.write_text(s,encoding='utf-8')
