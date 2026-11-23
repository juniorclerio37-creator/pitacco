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
p.write_text(s,encoding='utf-8')
