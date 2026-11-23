"""Substitui o antigo preparo de arquivos pelo Importador Inteligente real, somente no site."""
from pathlib import Path

p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
import_anchor="import Papa from 'papaparse';"
assert s.count(import_anchor)==1,'Importação do leitor de arquivos não encontrada'
s=s.replace(import_anchor,import_anchor+"\nimport UniversalMenuImporter from './UniversalMenuImporter.jsx';",1)

start_marker="{tab==='Importar cardápio'&&active&&<div className=\"panel\">"
end_marker="{tab==='Entrega externa'&&active&&"
start=s.find(start_marker)
end=s.find(end_marker,start)
assert start>=0 and end>start,'A antiga aba Importar cardápio mudou; não substituir às cegas'
replacement="""{tab==='Importar cardápio'&&active&&!nativeAvailable()&&!isDriver&&
 <UniversalMenuImporter key={selected} client={supabase} storeId={selected} onCompleted={loadDetails}/>}
 """
s=s[:start]+replacement+s[end:]
# Unificar acesso: uma única importação no Meu Cardápio e no botão do editor.
submenu_old="'Meu Cardápio':[['Produtos','Editor de cardápio']]"
submenu_new="'Meu Cardápio':[['Produtos','Editor de cardápio'],['Importar cardápio','Importar cardápio']]"
assert s.count(submenu_old)==1, 'Submenu do catálogo não encontrado ou alterado'
s=s.replace(submenu_old,submenu_new,1)
editor_old="<MenuStudio client={supabase} storeId={selected} products={products} onRefresh={loadDetails}/>"
editor_new="<MenuStudio client={supabase} storeId={selected} products={products} onRefresh={loadDetails} onImport={()=>setTab('Importar cardápio')}/>"
assert s.count(editor_old)==1, 'Editor do cardápio não encontrado para ligação ao importador'
s=s.replace(editor_old,editor_new,1)

p.write_text(s,encoding='utf-8')
