"""Keep email/password authentication in Supabase and explain the outcome."""
from pathlib import Path

path = Path('web/src.jsx')
source = path.read_text(encoding='utf-8')
start = source.index('async function submitAuth(e){')
end = source.index('\nasync function execute(', start)
path.write_text(source[:start] + """async function submitAuth(event) {
 event.preventDefault();
 setLoading(true);
 setMessage('');
 const form = new FormData(event.currentTarget);
 const email = String(form.get('email')).trim(), password = String(form.get('password'));
 const registering = authMode === 'register';
 try {
  const {data, error} = registering
   ? await supabase.auth.signUp({email, password, options:{data:{full_name:form.get('name')}}})
   : await supabase.auth.signInWithPassword({email, password});
  if (error) throw error;
  if (registering && !data.session) {
   setAuthMode('login');
   setMessage('Se este e-mail já estiver cadastrado, entre com sua senha. Se acabou de criar a conta, confirme o cadastro pelo link enviado ao seu e-mail.');
  } else {
   setMessage(registering ? 'Cadastro concluído.' : 'Login realizado.');
  }
 } catch (error) {
  setMessage(error.message || 'Não foi possível concluir o acesso. Tente novamente.');
 } finally {
  setLoading(false);
 }
}""" + source[end:], encoding='utf-8')
