"""Mount store-specific storefront and checkout settings in the restored applications."""
from pathlib import Path


def replace_once(source, old, new):
    assert source.count(old) == 1, old
    return source.replace(old, new, 1)


p = Path('web/src.jsx')
s = p.read_text(encoding='utf-8')
s = replace_once(s, "import StoreProfile from './StoreProfile.jsx';", """import StoreProfile from './StoreProfile.jsx';
import {StorefrontShare, StorefrontPayments, StoreDeliveryArea, useStorefrontMenu} from './StorefrontSettings.jsx';
import './storefront.css';""")
s = replace_once(s, "['Minha Loja','Dados da loja'],", "['Minha Loja','Dados da loja'],['Área de entrega','Área de entrega'],['Pagamentos da loja','Pagamentos'],")
s = replace_once(s, "['Minha Loja','Agendamento','WhatsApp','Configurações','Equipe','Lojas']", "['Minha Loja','Área de entrega','Pagamentos da loja','Agendamento','WhatsApp','Configurações','Equipe','Lojas']")
s = replace_once(s, "const storeAccess=useStoreManagerAccess(supabase,session?.user?.id,nativeAvailable()?null:selected);", """const storeAccess=useStoreManagerAccess(supabase,session?.user?.id,nativeAvailable()?null:selected);
const storefront=useStorefrontMenu(supabase, selected, profile?.role==='entregador'?null:session?.user?.id, !nativeAvailable()&&storeAccess.manager);""")
s = replace_once(s, '</select></header>{message&&', '</select></header>{active&&<StorefrontShare key={selected} menu={storefront.menu} native={nativeAvailable()}/>}\n{message&&')
s = replace_once(s, "['Minha Loja','Configurações','Agendamento'].includes(tab)", "['Minha Loja','Configurações','Agendamento','Área de entrega','Pagamentos da loja'].includes(tab)")
needle = '''<button className={tab==='Minha Loja'?'active':'secondary'} onClick={()=>setTab('Minha Loja')}>Identidade da loja</button>'''
s = replace_once(s, needle, needle+"""\n{manager&&!nativeAvailable()&&<>
 <button className={tab==='Área de entrega'?'active':'secondary'} onClick={()=>setTab('Área de entrega')}>Área de entrega</button>
 <button className={tab==='Pagamentos da loja'?'active':'secondary'} onClick={()=>setTab('Pagamentos da loja')}>Pagamentos</button>
</>}""")
needle = "{tab==='Minha Loja'&&active&&<StoreProfile key={selected} client={supabase} store={active} manager={manager} onSaved={loadStores}/>}"
s = replace_once(s, needle, needle+"""
{active&&!nativeAvailable()&&['Área de entrega','Pagamentos da loja'].includes(tab)&&(manager
 ?(tab==='Área de entrega'
  ?<StoreDeliveryArea key={selected} client={supabase} store={active}/>
  :<StorefrontPayments key={selected} client={supabase} storeId={selected} resource={storefront}/>)
 :<section className="panel"><p>Somente gestores podem editar estas configurações.</p></section>)}""")
p.write_text(s, encoding='utf-8')

p = Path('web/src-tauri/src/main.rs')
s = p.read_text(encoding='utf-8')
s = replace_once(s, '#[tauri::command]fn device_id', '''#[tauri::command]
fn open_storefront(slug: String) -> Result<(), String> {
    let valid = (3..=60).contains(&slug.len())
        && !slug.starts_with('-')
        && slug.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-');
    if !valid {
        return Err("Endereço do cardápio inválido.".into());
    }
    #[cfg(windows)]
    {
        let address = format!("https://pitacco.com.br/{slug}");
        std::process::Command::new("explorer.exe")
            .arg(address)
            .spawn()
            .map(|_| ())
            .map_err(|_| "Não foi possível abrir o navegador.".into())
    }
    #[cfg(not(windows))]
    {
        Err("Disponível no Windows.".into())
    }
}
#[tauri::command]fn device_id''')
s = replace_once(s, 'tauri::generate_handler![device_id,', 'tauri::generate_handler![open_storefront,device_id,')
p.write_text(s, encoding='utf-8')
