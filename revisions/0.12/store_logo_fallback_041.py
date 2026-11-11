"""Use the store's saved logo when no separate customer-branding logo is configured."""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
needle="const primary=primaryOf(tab);"
assert s.count(needle)==1
s=s.replace(needle,"const storeLogoUrl=storeBrand?.logo_url&&/^https:\\/\\//.test(storeBrand.logo_url)?storeBrand.logo_url:(active?.logo_path&&active.logo_path.startsWith('stores/'+selected+'/')?supabase.storage.from('pitacco-media').getPublicUrl(active.logo_path).data.publicUrl:null);\n"+needle,1)
needle="storeBrand?.logo_url&&/^https:\\/\\//.test(storeBrand.logo_url)?<img src={storeBrand.logo_url}"
assert s.count(needle)==1
s=s.replace(needle,"storeLogoUrl?<img src={storeLogoUrl}",1)
p.write_text(s,encoding='utf-8')
