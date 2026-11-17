import React,{useCallback,useEffect,useRef,useState} from 'react';
import {CheckCircle2,Copy,KeyRound,Loader2,Plus,RefreshCw,ShieldCheck,UserRoundCheck,UserRoundX} from 'lucide-react';
import './CourierAccessManager.css';

// Inside Motoboys > Entregadores. The merchant remains on app.pitacco.com.br.
// Supabase Edge Function verifies store_members membership before privileged actions.
// No service_role key or user creation takes place in the browser.
async function callCourierAccess(client,action,params){
  const {data:sessionData,error:sessionError}=await client.auth.getSession();
  if(sessionError||!sessionData?.session?.access_token)throw new Error('Sua sessão expirou. Faça login novamente no Pitacco.');
  const {data,error}=await client.functions.invoke('pitacco-courier-access',{
    body:{action,...params}
  });
  if(error){
    let message='Não foi possível concluir a operação.';
    try{
      if(error.context?.json){
        const detail=await error.context.json();
        message=detail?.error||message;
      } else if(error.message)message=error.message;
    }catch{if(error.message)message=error.message}
    throw new Error(message);
  }
  if(!data||typeof data!=='object')throw new Error('Resposta inválida do serviço de entregadores.');
  return data;
}
export default function CourierAccessManager({client,store,onDataChanged}){
  const [couriers,setCouriers]=useState([]);
  const [name,setName]=useState('');
  const [phone,setPhone]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [credential,setCredential]=useState(null);
  const operation=useRef(0);

  const refresh=useCallback(async()=>{
    const current=++operation.current;
    const result=await callCourierAccess(client,'list',{storeId:store.id});
    if(current===operation.current)setCouriers(result.couriers||[]);
    return result;
  },[client,store.id]);

  useEffect(()=>{
    let active=true;
    operation.current++;
    setCouriers([]);setCredential(null);setMessage('');setError('');setLoading(true);
    refresh().catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});
    return ()=>{active=false;operation.current++;};
  },[refresh]);

  function reveal(result,forCourier){
    const secret=result?.temporaryPassword;
    if(!secret)throw new Error('O serviço não retornou a senha. Solicite redefinição antes de informar o acesso.');
    setCredential({password:secret,phone:forCourier});
    setMessage('Senha temporária gerada. Entregue-a de forma segura ao motoboy. No primeiro acesso, ele criará uma nova senha.');
  }
  async function run(callback){
    if(busy)return;
    setBusy(true);setError('');setMessage('');
    try{
      await callback();
      await refresh();
      await onDataChanged?.();
    }catch(e){setError(e?.message||'Não foi possível concluir a operação.');}
    finally{setBusy(false);}
  }
  async function register(event){
    event.preventDefault();
    if(!name.trim()||!phone.trim())return;
    const submittedPhone=phone;
    await run(async()=>{
      setCredential(null);
      const result=await callCourierAccess(client,'create',{storeId:store.id,name:name.trim(),phone:submittedPhone});
      reveal(result,result.courier?.phone||submittedPhone);
      setName('');setPhone('');
    });
  }
  async function action(type,courier){
    const text={
      reset:'Redefinir a senha de '+courier.name+'? A senha antiga deixará de funcionar.',
      disable:'Desativar '+courier.name+'? Ele perderá o acesso às entregas da loja.',
      reactivate:'Reativar '+courier.name+' com uma nova senha temporária?'
    }[type];
    if(!window.confirm(text))return;
    await run(async()=>{
      setCredential(null);
      const result=await callCourierAccess(client,type,{storeId:store.id,courierId:courier.id});
      if(type==='reset'||type==='reactivate')reveal(result,courier.phone);
      else setMessage(courier.name+' foi desativado.');
    });
  }
  const copy=async()=>{
    if(!credential)return;
    try{
      await navigator.clipboard.writeText(credential.password);
      setMessage('Senha temporária copiada. Envie somente ao entregador responsável.');
    }catch{setError('Não foi possível copiar. Selecione a senha exibida e copie manualmente.');}
  };
  return <section className="pitacco-driver-access panel" aria-label="Controle de acesso dos entregadores">
    <header className="pitacco-driver-access-header">
      <div><h3><ShieldCheck size={20}/> Acesso dos motoboys</h3>
        <p>Cadastre sua equipe por celular. Os entregadores não precisam criar conta nem informar e-mail.</p></div>
      <button type="button" className="secondary" onClick={()=>run(refresh)} disabled={busy||loading}><RefreshCw size={16}/> Atualizar</button>
    </header>
    {error&&<p role="alert" className="notice error">{error}</p>}
    {message&&<p role="status" className="notice">{message}</p>}
    {credential&&<div className="pitacco-driver-credential" role="status" aria-live="polite">
      <div><KeyRound size={20}/><strong>Senha temporária — {credential.phone}</strong></div>
      <p>Esta senha aparece apenas agora. O entregador deve alterá-la no primeiro acesso ao aplicativo.</p>
      <code>{credential.password}</code>
      <div className="pitacco-driver-access-buttons">
        <button type="button" onClick={copy}><Copy size={15}/> Copiar senha</button>
        <button type="button" className="secondary" onClick={()=>setCredential(null)}>Ocultar</button>
      </div>
    </div>}
    <form className="pitacco-driver-register" onSubmit={register}>
      <label className="field">Nome do entregador
        <input type="text" required minLength={2} maxLength={100} autoComplete="off" placeholder="Nome completo" value={name} onChange={e=>setName(e.target.value)}/></label>
      <label className="field">Telefone com DDD
        <input type="tel" required inputMode="tel" autoComplete="off" placeholder="(21) 99999-9999" value={phone} onChange={e=>setPhone(e.target.value)}/></label>
      <button type="submit" disabled={busy||loading}><Plus size={16}/> Cadastrar entregador</button>
    </form>
    <div className="pitacco-driver-team">
      <h4>Contas de entregadores ({couriers.length})</h4>
      {loading?<p className="hint"><Loader2 size={16}/> Carregando...</p>:!couriers.length?<p className="hint">Nenhum motoboy cadastrado nesta loja.</p>:
      <div className="pitacco-driver-team-list">{couriers.map(c=><article className="pitacco-driver-team-row" key={c.id}>
        <div className="pitacco-driver-person">
          <strong>{c.name}</strong><span>{c.phone||'Telefone não informado'}</span>
          <small className={c.active?'pitacco-driver-active':'pitacco-driver-inactive'}>{c.active?<><CheckCircle2 size={13}/> Ativo</>:<><UserRoundX size={13}/> Desativado</>}</small>
        </div>
        <div className="pitacco-driver-access-buttons">
          {c.active?<><button type="button" className="secondary" disabled={busy} onClick={()=>action('reset',c)}><KeyRound size={15}/> Redefinir senha</button>
            <button type="button" className="secondary" disabled={busy} onClick={()=>action('disable',c)}><UserRoundX size={15}/> Desativar</button></>:
            <button type="button" disabled={busy} onClick={()=>action('reactivate',c)}><UserRoundCheck size={15}/> Reativar</button>}
        </div>
      </article>)}</div>}
    </div>
    <p className="hint">O motoboy entra no Pitacco Entregador com celular e senha, sem SMS ou e-mail. Para acessos cadastrados antes desta atualização, use “Redefinir senha” uma vez para ativar o novo login. Senha esquecida? Redefina aqui.</p>
  </section>;
}
