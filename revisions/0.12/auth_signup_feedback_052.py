"""Clarify signup confirmation and switch to login when account exists.
Keep password login and confirmation security managed by Supabase.
"""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
old="setLoading(false);setMessage(result.error?result.error.message:authMode==='register'?'Conta criada. Verifique seu e-mail se a confirmação estiver habilitada.':'Login realizado.');"
new="""setLoading(false);
 if(result.error){setMessage(result.error.message);return}
 if(authMode==='register'){
  setAuthMode('login');
  setMessage(result.data?.session?'Cadastro concluído. Acesso autorizado.':result.data?.user?.identities?.length===0?'Este e-mail já possui cadastro. Entre com sua senha.':'Cadastro recebido. Se a confirmação de e-mail estiver habilitada, abra o link enviado antes de entrar.');
 }else setMessage('Login realizado.');"""
assert s.count(old)==1,'auth callback changed'
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
