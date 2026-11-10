"""Add user-controlled light/dark content theme; sidebar stays warm orange."""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
needle="function App(){const[session"
assert s.count(needle)==1
s=s.replace(needle,"function App(){const [theme,setTheme]=useState(()=>{try{return window.localStorage.getItem('pitacco-theme')==='dark'?'dark':'light'}catch{return 'light'}});\nuseEffect(()=>{try{window.localStorage.setItem('pitacco-theme',theme)}catch{}},[theme]);\nconst[session",1)
needle='return <div className="app"><aside>'
assert s.count(needle)==1
s=s.replace(needle,'return <div className={"app pitacco-theme-"+theme}><aside>',1)
needle='<small className="account">{profile?.email}'
assert s.count(needle)==1
s=s.replace(needle,'<div className="theme-switch"><span>Aparência</span><div role="group" aria-label="Modo de aparência"><button type="button" aria-pressed={theme==="light"} className={theme==="light"?"selected":""} onClick={()=>setTheme("light")}>☀ Claro</button><button type="button" aria-pressed={theme==="dark"} className={theme==="dark"?"selected":""} onClick={()=>setTheme("dark")}>☾ Escuro</button></div></div>'+needle,1)
p.write_text(s,encoding='utf-8')
