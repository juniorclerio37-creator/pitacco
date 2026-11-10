"""Add an owner-only release center without pretending the updater is deployed."""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
anchor="['Assinaturas','Assinatura · R$ 59,90']"
assert s.count(anchor)==1
s=s.replace(anchor,anchor,1)
needle="['Financeiro',Wallet,'Principal']"
assert s.count(needle)==1
s=s.replace(needle,"['Atualizações',Settings,'Principal'],"+needle,1)
needle="const primaryOf=t=>"
assert s.count(needle)==1
# Keep owner-only menu entry and do not show it to store managers.
# Make the release center visible on both web and Windows for the platform owner.
native_filter="'Visão Geral','Pedidos','Motoboys','Caixa','Administrar Loja','Financeiro','Fideliza+','Clientes'"
assert s.count(native_filter)==1
s=s.replace(native_filter,native_filter+",'Atualizações'",1)
needle=".filter(([name])=>!isDriver||name==='Motoboys')"
assert s.count(needle)==1
s=s.replace(needle,".filter(([name])=>name!=='Atualizações'||admin)"+needle,1)
needle="const descriptions="
assert s.count(needle)==1
# Page is separate from store settings and never exposes a publish button without a release backend.
needle="{tab==='Lojas'&&"
assert s.count(needle)==1
panel="""{tab==='Atualizações'&&admin&&<section className="release-center" aria-label="Central de atualizações"><div className="page-intro"><div><span className="eyebrow">ADMINISTRAÇÃO DA PLATAFORMA</span><h3>Central de atualizações</h3><p>Controle a distribuição de versões assinadas do aplicativo Windows. Esta área é exclusiva do administrador do Pitacco.</p></div></div><div className="metrics"><article><span>Distribuição</span><strong>Em preparação</strong></article><article><span>Canal</span><strong>Estável</strong></article></div><div className="panel"><h3>Publicação de versões</h3><p>O GitHub Actions compila o instalador. Para permitir a atualização dentro do aplicativo, o próximo passo é configurar o plugin Updater do Tauri, a chave pública de verificação e o manifesto assinado de cada versão.</p><p>Não publique atualizações sem assinatura válida nem distribua chaves privadas aos lojistas.</p><a href="https://github.com/juniorclerio37-creator/pitacco/releases" target="_blank" rel="noopener noreferrer">Consultar versões no GitHub Releases</a></div><div className="panel"><h3>Política de segurança</h3><p>Atualizações devem aguardar a conclusão dos pedidos em andamento, preservar a fila local de impressão e manter os dados e as configurações da loja. Atualizações obrigatórias só devem ser habilitadas após testes.</p></div></section>}
"""
s=s.replace(needle,panel+needle,1)
p.write_text(s,encoding='utf-8')
