// Explicit Core login, shared by web and Windows. No legacy-token exchange,
// localStorage persistence, automatic login or silent fallback.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const roles=new Set(['owner','manager','operator','courier']);
function identity(v){
 if(!UUID.test(v?.id??'')||typeof v.email!=='string'||!Array.isArray(v.stores))throw Error('Identidade inválida.');
 const stores=v.stores.map(s=>{
  if(!UUID.test(s?.store_id??'')||typeof s.name!=='string'||!roles.has(s.role))throw Error('Vínculo inválido.');
  return {store_id:s.store_id,name:s.name,role:s.role};
 });
 if(new Set(stores.map(s=>s.store_id)).size!==stores.length)throw Error('Vínculo duplicado.');
 return {id:v.id,email:v.email,stores};
}
export function createCoreSession({fetcher=globalThis.fetch,onState=()=>{},now=Date.now}={}){
 let token='',expires=0,person=null,selected=null,version=0,scopeVersion=0,scope=null,busy=false,controller=new AbortController();
 const resources=new Set();
 const snapshot=()=>({identity:person?{...person,stores:person.stores.map(s=>({...s}))}:null,selected:selected?{...selected}:null,expires_at:expires||null});
 function emit(){onState(snapshot());}
 function clearScope(){
  scopeVersion++;selected=null;scope=null;
  for(const resource of resources){try{resource.stop();}catch{}}
  resources.clear();
 }
 function clear(){
  version++;controller.abort();controller=new AbortController();clearScope();
  token='';expires=0;person=null;busy=false;emit();
 }
 function expire(){if(token&&now()>=expires)clear();}
 async function http(path,{method='GET',body,credential=token,signal=controller.signal}={}){
  const res=await fetcher('/api/v1'+path,{method,headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...(credential?{Authorization:'Bearer '+credential}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.any([signal,AbortSignal.timeout(8000)])});
  if(!res.ok){const e=Error(res.status===401?'Sessão não autorizada.':'Serviço indisponível.');e.status=res.status;throw e;}
  return res.json();
 }
 async function login(email,password){
  if(busy)throw Error('Operação em andamento.');
  if(token)throw Error('Encerre a sessão atual antes de entrar novamente.');
  if(typeof email!=='string'||typeof password!=='string'||!email.trim()||!password)throw Error('Informe e-mail e senha.');
  busy=true;const v=version;const signal=controller.signal;let issued='';
  try{
   const res=await http('/auth/login',{method:'POST',body:{email,password},credential:'',signal});
   if(!/^[a-f0-9]{64}$/.test(res.access_token??'')||res.token_type!=='Bearer')throw Error('Sessão inválida.');
   issued=res.access_token;const exp=Date.parse(res.expires_at);
   if(!Number.isFinite(exp)||exp<=now()||v!==version)throw Error('Sessão encerrada.');
   const me=identity(await http('/auth/me',{credential:issued,signal}));
   if(v!==version||now()>=exp)throw Error('Sessão encerrada.');
   token=issued;issued='';expires=exp;person=me;emit();return snapshot();
  }finally{
   // Revoke a token issued during a cancelled or failed login, best effort.
   if(issued)try{await http('/auth/logout',{method:'POST',credential:issued,signal:new AbortController().signal});}catch{}
   if(v===version)busy=false;
  }
 }
 async function refresh(){
  expire();if(!token)throw Error('Sessão encerrada.');
  const v=version;
  try{
   const next=identity(await http('/auth/me'));
   if(v!==version||!token)throw Error('Sessão encerrada.');
   if(next.id!==person.id){clear();throw Error('Identidade alterada.');}
   if(selected&&!next.stores.some(s=>s.store_id===selected.store_id&&s.role===selected.role))clearScope();
   person=next;emit();return snapshot();
  }catch(e){if(v===version&&e.status===401)clear();throw e;}
 }
 async function selectStore(id){
  expire();if(!token||!UUID.test(id??''))throw Error('Sessão inválida.');
  if(!person.stores.some(s=>s.store_id===id))throw Error('Loja não autorizada.');
  clearScope();emit();const v=version,sv=scopeVersion;
  try{
   const {data}=await http('/stores/'+id+'/context');
   if(v!==version||sv!==scopeVersion||!token)throw Error('Seleção encerrada.');
   if(data?.store_id!==id||typeof data.name!=='string'||!person.stores.some(s=>s.store_id===id&&s.role===data.role))throw Error('Vínculo inconsistente.');
   selected={store_id:id,name:data.name,role:data.role};emit();return {...selected};
  }catch(e){if(v===version&&e.status===401)clear();throw e;}
 }
 // Scoped fetch never discloses a bearer to application components. Only
 // exact relative API paths for the active store may be requested.
 function scopedFetch(){
  expire();if(!token||!selected||selected.role==='courier')throw Error('Loja não autorizada.');
  const v=version,sv=scopeVersion,id=selected.store_id;
  if(scope)return scope;
  scope=async(path,opts={})=>{
   expire();if(v!==version||sv!==scopeVersion||!token)throw Error('Seleção encerrada.');
   const prefix='/api/v1/stores/'+id+'/';
   if(typeof path!=='string'||!path.startsWith(prefix)||/[\\%#]/.test(path)||path.split('?')[0].split('/').some(x=>x==='.'||x==='..'))throw Error('Destino não autorizado.');
   const headers=new Headers(opts.headers);headers.set('Authorization','Bearer '+token);
   const signal=opts.signal?AbortSignal.any([opts.signal,controller.signal]):controller.signal;
   const res=await fetcher(path,{...opts,headers,signal,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
   if(v!==version||sv!==scopeVersion)throw Error('Seleção encerrada.');
   if(res.status===401){clear();throw Error('Sessão encerrada.');}
   return res;
  };return scope;
 }
 function attach(resource){
  expire();if(!token||!selected||typeof resource?.stop!=='function')throw Error('Seleção inválida.');
  resources.add(resource);return ()=>{if(resources.delete(resource))resource.stop();};
 }
 async function logout(){
  const credential=token;clear();
  if(!credential)return {revoked:false};
  try{const res=await http('/auth/logout',{method:'POST',credential,signal:new AbortController().signal});return {revoked:res.status==='revoked'};}
  catch{return {revoked:false};}
 }
 return {login,refresh,selectStore,scopedFetch,attach,logout,stop:clear,snapshot:()=>{expire();return snapshot();}};
}
