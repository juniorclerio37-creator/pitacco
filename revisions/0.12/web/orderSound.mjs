export function playOrderChime(context){
 const now=context.currentTime;
 for(const [frequency,start,duration] of [[880,now+0.02,0.55],[1320,now+0.12,0.42]]){
  const oscillator=context.createOscillator(),gain=context.createGain();
  oscillator.type='sine';
  oscillator.frequency.setValueAtTime(frequency,start);
  gain.gain.setValueAtTime(0.0001,start);
  gain.gain.exponentialRampToValueAtTime(0.19,start+0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001,start+duration);
  oscillator.connect(gain);gain.connect(context.destination);
  oscillator.start(start);oscillator.stop(start+duration);
 }
}

export function sayNewOrder(){
 if(!('speechSynthesis' in window)||typeof SpeechSynthesisUtterance!=='function')return;
 const phrase=new SpeechSynthesisUtterance('Você tem um novo pedido.');
 phrase.lang='pt-BR';phrase.rate=0.93;phrase.volume=1;
 const speech=window.speechSynthesis;
 setTimeout(()=>speech.speak(phrase),650);
}
