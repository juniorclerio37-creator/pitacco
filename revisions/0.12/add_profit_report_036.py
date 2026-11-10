from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
assert "import Operations from './Operations.jsx';" in s
s=s.replace("import Operations from './Operations.jsx';","import Operations from './Operations.jsx';\nimport ProfitReport from './ProfitReport.jsx';".replace('\\n','\n'),1)
needle="{tab==='Lançamentos'&&active&&<>"
assert s.count(needle)==1
s=s.replace(needle,"{tab==='Lançamentos'&&active&&<ProfitReport client={supabase} storeId={selected}/>}\n"+needle,1)
p.write_text(s,encoding='utf-8')
