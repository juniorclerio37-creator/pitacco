"""Add a single bell then spoken alert for genuinely new incoming orders."""
from pathlib import Path
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
needle=" const seen=useRef(new Set()),soundRef=useRef(false),notifySeen=useRef(new Set());"
assert s.count(needle)==1
s=s.replace(needle,needle+"\n const ordersInitialized=useRef(false);",1)
needle="   setDetail(null);seen.current=new Set();notifySeen.current=new Set();setOrders([]);"
assert s.count(needle)==1
s=s.replace(needle,"   setDetail(null);seen.current=new Set();ordersInitialized.current=false;notifySeen.current=new Set();setOrders([]);",1)
needle="    const fresh=incoming.filter(o=>o.status==='pending'&&!seen.current.has(o.id));"
assert s.count(needle)==1
s=s.replace(needle,"    const fresh=ordersInitialized.current?incoming.filter(o=>o.status==='pending'&&!seen.current.has(o.id)):[];\n    ordersInitialized.current=true;",1)
needle="""     if(desktop)invoke('notify',{message:`${fresh.length} pedido(s) aguardando aceite.`}).catch(e=>setError('Notificação: '+String(e)));
     else if(soundRef.current){try{const context=new AudioContext();const osc=context.createOscillator();osc.connect(context.destination);osc.start();osc.stop(context.currentTime+0.2);osc.onended=()=>context.close()}catch{}}
"""
assert s.count(needle)==1
replacement="""     if(desktop)invoke('notify',{message:`${fresh.length} pedido(s) aguardando aceite.`}).catch(()=>{});
     if(desktop||soundRef.current){
      try{
       const Ctx=window.AudioContext||window.webkitAudioContext;
       if(Ctx){
        const ctx=new Ctx();
        const bell=(frequency,start,duration)=>{
         const oscillator=ctx.createOscillator(),gain=ctx.createGain();
         oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency,start);
         gain.gain.setValueAtTime(0.0001,start);
         gain.gain.exponentialRampToValueAtTime(0.19,start+0.012);
         gain.gain.exponentialRampToValueAtTime(0.0001,start+duration);
         oscillator.connect(gain);gain.connect(ctx.destination);
         oscillator.start(start);oscillator.stop(start+duration);
        };
        bell(880,ctx.currentTime+0.02,0.55);
        bell(1320,ctx.currentTime+0.12,0.42);
        setTimeout(()=>ctx.close().catch(()=>{}),1100);
       }
      }catch(e){console.warn('Alerta sonoro indisponível',e)}
      try{
       if('speechSynthesis' in window){
        const phrase=new SpeechSynthesisUtterance('Você tem um novo pedido.');
        phrase.lang='pt-BR';phrase.rate=0.93;phrase.volume=1;
        setTimeout(()=>window.speechSynthesis.speak(phrase),650);
       }
      }catch(e){console.warn('Voz de pedido indisponível',e)}
     }
"""
s=s.replace(needle,replacement,1)
p.write_text(s,encoding='utf-8')
