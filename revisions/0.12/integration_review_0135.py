from pathlib import Path
p=Path('web/src.jsx');s=p.read_text(encoding='utf-8')
old="if(!live||error||data?.store_id!==selected)return;const path=data.logo_path;"
new="""if(!live||error||data?.store_id!==selected)return;
 const {data:canonical,error:storeError}=await supabase.from('stores').select('*').eq('id',selected).single();
 if(!live)return;
 if(!storeError&&canonical?.id===selected)setStores(current=>current.map(row=>row.id===selected?canonical:row));
 const path=data.logo_path;"""
assert s.count(old)==1;s=s.replace(old,new)
# Novo Pedido is rendered only by OperationalShortcuts in MerchantNavigation.
s=s.replace('0.12.34','0.12.37');p.write_text(s,encoding='utf-8')
for relative in ['package.json','package-lock.json','src-tauri/tauri.conf.json','src-tauri/Cargo.toml','src-tauri/Cargo.lock']:
 p=Path('web')/relative;p.write_text(p.read_text(encoding='utf-8').replace('0.12.34','0.12.37'),encoding='utf-8')
p=Path('web/style.css');p.write_text(p.read_text(encoding='utf-8')+Path('revisions/0.12/new-sale-0135.css').read_text(encoding='utf-8'),encoding='utf-8')
