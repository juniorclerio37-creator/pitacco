import {discoverCourierReleaseWithFallback,compareCourierVersions} from './app-update.mjs';

/** Update UX is independent of order alerts and never makes the courier offline. */
export function mountCourierUpdateUI({client,onOpenSettings,onVersion,request=fetch,clock=()=>Date.now()}){
 const $=id=>document.getElementById(id);
 const native=window.PitaccoUpdater?.postMessage?window.PitaccoUpdater:null;
 const state={installed:null,latest:null,lastCheck:0,checking:false};
 const installed=$('courierInstalledVersion'),status=$('courierUpdateStatus');
 const action=$('installCourierUpdate'),hint=$('courierUpdateHint');
 const check=$('checkCourierUpdate');
 const message=(value,kind='info')=>{status.textContent=value;status.dataset.kind=kind;};
 function render(){
  const comparison=state.latest&&state.installed?compareCourierVersions(state.latest.version,state.installed):null;
  hint.hidden=true;action.hidden=true;
  if(comparison===1){
   message('Nova versão '+state.latest.version+' disponível. Atualize para receber as correções mais recentes.','available');
   hint.hidden=false;
   $('courierUpdateHintText').textContent='Pitacco Entregador '+state.latest.version+' disponível';
   action.hidden=!native;
  }else if(native&&comparison!==null){
   message('Seu Pitacco Entregador está atualizado.','success');
  }else if(!native&&window.PitaccoPush?.postMessage){
   message('Esta versão antiga ainda não atualiza pelo próprio app. Para ativar essa função, abra entregador.pitacco.com.br no navegador do celular e instale o novo APK.','warning');
   if(state.latest&&compareCourierVersions(state.latest.version,'2.0.15')===1){
    hint.hidden=false;
    $('courierUpdateHintText').textContent='Nova versão '+state.latest.version+' disponível. Para esta primeira atualização, use o navegador do celular.';
   }
  }else{
   message('Para instalar o app, acesse entregador.pitacco.com.br no Android.','info');
  }
 }
 async function refresh(force=false) {
  if(state.checking)return;
  if(native&&!state.installed){native.postMessage('version');return;}
  if(!force&&state.lastCheck&&clock()-state.lastCheck<60*60*1000)return;
  state.checking=true;check.disabled=true;
  message('Consultando as versões oficiais assinadas…');
  try {
   state.latest=await discoverCourierReleaseWithFallback(request,fn=>client.rpc(fn));
   state.lastCheck=clock();
   render();
  }catch(error) {
   message('Não foi possível verificar as atualizações. Confira a internet e tente novamente.','error');
  }finally{
   state.checking=false;check.disabled=false;
  }
 }
 if(native) {
  native.addEventListener('message',event=>{
   const data=String(event.data||'');
   if(data.startsWith('version:')){
    state.installed=data.slice(8);
    if(/^[0-9]+[.][0-9]+[.][0-9]+$/.test(state.installed))onVersion?.(state.installed);
    installed.textContent='Versão instalada: '+state.installed;
    void refresh(true);
   }else if(data==='update:downloading'){
    action.disabled=true;message('Baixando o APK oficial e conferindo a integridade…');
   }else if(data==='update:verified'){
    message('Arquivo validado. O Android vai confirmar a instalação.','available');
   }else if(data==='update:permission'){
    action.disabled=false;message('Autorize o Pitacco a instalar atualizações nas configurações do Android.','warning');
   }else if(data==='update:installer'){
    action.disabled=false;message('Confirme a atualização na tela do Android.','available');
   }else if(data==='update:postponed'){
    action.disabled=false;message('Atualização adiada. Você poderá instalar depois.','warning');
   }else if(data==='update:busy'){
    message('Uma atualização já está em andamento.','warning');
   }else if(data==='update:current'){
    action.disabled=false;void refresh(true);
   }else if(data.startsWith('update:error:')){
    action.disabled=false;message(data.slice('update:error:'.length),'error');
   }
  });
  native.postMessage('version');
 }else{
  installed.textContent=window.PitaccoPush?.postMessage?'Versão anterior à atualização interna':'Acesso pelo navegador';
  void refresh(true);
 }
 check.addEventListener('click',()=>{
  state.lastCheck=0;
  if(native)native.postMessage('version');
  else void refresh(true);
 });
 action.addEventListener('click',()=>{
  if(!native||!state.latest)return;
  action.disabled=true;
  native.postMessage('install:'+JSON.stringify({
   version:state.latest.version,url:state.latest.url,
   filename:state.latest.filename,sha256:state.latest.sha256
  }));
 });
 $('openUpdateSettings').addEventListener('click',()=>onOpenSettings());
 // No permanent global red alert. Recheck at most once per six hours in an
 // active session, while a manual refresh remains available in Ajustes.
 const poll=()=>{if(document.visibilityState==='visible'&&clock()-state.lastCheck>6*60*60*1000)void refresh();};
 window.setInterval(poll,15*60*1000);
 return {refresh,current:()=>state.installed,latest:()=>state.latest};
}
