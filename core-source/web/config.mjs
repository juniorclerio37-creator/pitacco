export function validateConnection(url,key){
 let parsed;try{parsed=new URL(String(url).trim())}catch{return 'Informe a URL HTTPS do projeto Supabase.'}
 if(parsed.protocol!=='https:'||!/^([a-z0-9-]+)\.supabase\.co$/i.test(parsed.hostname)||parsed.port||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/')return 'Use https://seu-projeto.supabase.co, sem caminhos ou credenciais.';
 const value=String(key||'').trim();if(value.startsWith('sb_secret_'))return 'Chaves secretas não podem ser usadas no aplicativo.';
 if(/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(value))return '';
 try{const parts=value.split('.');if(parts.length!==3||!parts[2])throw Error();const payload=JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));if(payload.role!=='anon')return 'Use somente a chave pública anon ou publishable. Nunca service_role.';return ''}catch{return 'Informe uma chave pública anon ou publishable válida.'}
}
export function connectionConfig(env={},storage){
 let url='',key='';try{url=storage?.getItem('dg.supabase.url')||'';key=storage?.getItem('dg.supabase.key')||''}catch{}
 url=env.VITE_SUPABASE_URL||url;key=env.VITE_SUPABASE_ANON_KEY||key;
 const error=validateConnection(url,key);return error?{url:'',key:'',error}:{url:url.trim().replace(/\/$/,''),key:key.trim(),error:''};
}
export function saveConnection(storage,url,key){const error=validateConnection(url,key);if(error)throw Error(error);storage.setItem('dg.supabase.url',url.trim().replace(/\/$/,''));storage.setItem('dg.supabase.key',key.trim());}
