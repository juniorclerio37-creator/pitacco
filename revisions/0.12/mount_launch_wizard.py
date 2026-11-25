"""Mount self-service onboarding after all existing Pitacco navigation overlays."""
from pathlib import Path

p=Path('web/src.jsx')
source=p.read_text(encoding='utf-8')

def once(old,new):
 global source
 count=source.count(old)
 assert count==1, f'Expected exactly one onboarding anchor ({count}): {old[:100]}'
 source=source.replace(old,new,1)

once("import StoreDesignStudio from './StoreDesignStudio.jsx';",
 """import StoreDesignStudio from './StoreDesignStudio.jsx';
import StoreLaunchWizard,{OnboardingNudge} from './StoreLaunchWizard.jsx';
import {ListChecks as LaunchChecksIcon} from 'lucide-react';""")

start=source.index('const nav=[')
end=source.index('];',start)
assert "'Primeiros passos'" not in source[start:end]
source=source[:end]+",['Primeiros passos',LaunchChecksIcon,'Configurações']"+source[end:]

anchor="{tab==='Minha Loja'&&active&&<StoreProfile key={selected} client={supabase} store={active} manager={manager} onSaved={loadStores} storeLogoUrl={storeBrand?.store_id===selected?storeBrand.logo_url:''} onAppearance={()=>setTab('Aparência do cardápio')}/>}"
once(anchor,anchor+"""
{tab==='Primeiros passos'&&active&&!nativeAvailable()&&(manager
 ?<StoreLaunchWizard key={selected} client={supabase} store={active} manager={manager}
     onNavigate={setTab} onStoreSaved={loadStores}/>
 :<section className="panel">Solicite acesso de gestor para configurar e verificar a loja.</section>)}""")
once("{tab==='Painel'&&active&&!nativeAvailable()&&<StoreOverview",
 """{tab==='Painel'&&active&&!nativeAvailable()&&manager&&
 <OnboardingNudge client={supabase} storeId={selected} onNavigate={setTab}/>}
{tab==='Painel'&&active&&!nativeAvailable()&&<StoreOverview""")

p.write_text(source,encoding='utf-8')
