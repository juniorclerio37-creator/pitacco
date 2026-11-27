import packageInfo from './package.json';
import OrderHistory from './OrderHistory.jsx';
import MerchantNewOrder from './MerchantNewOrder.jsx';
import WindowsReceiptPreview from './WindowsReceiptPreview.jsx';
import {buildPhysicalReceiptTest} from './receiptTestSample.mjs';
import {newOrderTracker} from './orderArrival.mjs';
import {useMemo} from 'react';
import {playOrderChime,sayNewOrder} from './orderSound.mjs';
import {operationRequestId} from './operationRequestId.mjs';
import {readPrintPreferences,savePrintPreference} from './printPreferences.mjs';
import {receiptItems} from './receiptItems.mjs';
import Pedidos from './Pedidos.jsx';
import {Printer} from 'lucide-react';
import {fetchDailyOrders} from './dailyOrders.mjs';
import {openBrowserPrint} from './browserReceipt.mjs';
import {WindowsConnectionStatus} from './WindowsConnectionStatus.jsx';
import {CUPOM_80MM_HTML} from './cupom80mm.mjs';
import Fideliza from './Fideliza.jsx';
import DeliveryDialog,{deliveryLabel} from './DeliveryDialog.jsx';
import {columns,orderStage,matchesOrder} from './orderBoard.mjs';
import React,{useEffect,useRef,useState} from 'react';
import {nativeAvailable,invoke,ingestJobs} from './printBridge.mjs';
import {publicOrderNumber,validLocalizer} from './orderDisplay.mjs';
const SOURCES=[['proprio','Cardápio próprio'],['ifood','iFood'],['99food','99Food'],['keeta','Keeta']];
const currency=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
let activeStoreCommand=Promise.resolve();
function queueActiveStore(storeId){const next=activeStoreCommand.catch(()=>{}).then(()=>invoke('set_active_store',{storeId}));activeStoreCommand=next;return next}
export default function Operations({client,storeId,view,manager,onNavigate,storeName='',storeLogoPath='',navigationSection='',navigationKey}){
 const nativePrintScope=useRef(null);
 async function waitForNativePrintStore(){
  const scope=nativePrintScope.current;
  if(!manager||!storeId||scope?.storeId!==storeId)return false;
  try{await scope.ready}catch{return false}
  return nativePrintScope.current===scope;
 }

 const desktop=nativeAvailable(),[orders,setOrders]=useState([]),[settings,setSettings]=useState([]),[sectors,setSectors]=useState([]),[jobs,setJobs]=useState([]),[printers,setPrinters]=useState([]),[device,setDevice]=useState(''),[autoStart,setAutoStart]=useState(false),[status,setStatus]=useState('Conectando…'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[sound,setSound]=useState(false);
 const [printerSources,setPrinterSources]=useState(''),[printerCategories,setPrinterCategories]=useState('');
 const [editingSector,setEditingSector]=useState(null);
 const [deviceBound,setDeviceBound]=useState(false),[boundDevice,setBoundDevice]=useState(null),[printMessage,setPrintMessage]=useState('');
 const [dispatchPolicy,setDispatchPolicy]=useState('manual');
 useEffect(()=>{
  let active=true;
  if(!storeId)return;
  function refreshDispatch(){client.from('stores').select('dispatch_mode').eq('id',storeId).single()
   .then(({data,error})=>{
    if(active&&!error)setDispatchPolicy(data?.dispatch_mode||'manual');
   }).catch(()=>{});}
  refreshDispatch();const timer=setInterval(refreshDispatch,5000);
  return ()=>{active=false;clearInterval(timer);};
 },[client,storeId]);
 const [printRequestFeedback,setPrintRequestFeedback]=useState('');
 const [settingsTab,setSettingsTab]=useState('Impressoras'),[orderFilter,setOrderFilter]=useState('board'),[query,setQuery]=useState(''),[deliveryRows,setDeliveryRows]=useState([]),[detail,setDetail]=useState(null),[dispatchOnly,setDispatchOnly]=useState(false),[courierRows,setCourierRows]=useState([]);
 const createRequest=useRef(null), paymentRequest=useRef(null), reprintRequests=useRef(new Map());
 useEffect(()=>{if(view==='Configurações'&&['Impressoras','Aceite de pedidos','Alertas e aplicativo'].includes(navigationSection))setSettingsTab(navigationSection)},[view,navigationSection,navigationKey]);
 const [orderBadges,setOrderBadges]=useState([]),[paymentSummary,setPaymentSummary]=useState([]),[paymentOrder,setPaymentOrder]=useState(null),[paymentAmount,setPaymentAmount]=useState(''),[paymentMethod,setPaymentMethod]=useState('dinheiro'),[paymentReference,setPaymentReference]=useState('');
 const audio=useRef(null),notifySeen=useRef(new Set());
 const [soundMessage,setSoundMessage]=useState('');
 const [alertLevel,setAlertLevel]=useState(()=>{
  try{const level=Number(localStorage.getItem('pitacco:native-alert-volume:'+storeId));return [1,2,3].includes(level)?level:3;}
  catch{return 3;}
 });
 const [voiceLevel,setVoiceLevel]=useState(()=>{
  try { const level=Number(localStorage.getItem('pitacco:natural-voice-level:'+storeId));return [1,2,3].includes(level)?level:3; }
  catch{return 1;}
 });
 const [voiceReady,setVoiceReady]=useState(false);
 const [bellChoice,setBellChoice]=useState(()=>{
  try{const value=localStorage.getItem('pitacco:bell-choice:'+storeId);
   return ['original','moderno','classico','duplo','intenso'].includes(value)?value:'original'
  }catch{return 'original'}
 });
 const bellChoiceRef=useRef(bellChoice);
 bellChoiceRef.current=bellChoice;

 // Keep the order subscription stable while its alert settings change.
 // Otherwise the original polling callback closes over voiceReady=false,
 // and a real incoming order never plays the merchant's recorded voice.
 const alertLevelRef=useRef(alertLevel),voiceLevelRef=useRef(voiceLevel),voiceReadyRef=useRef(voiceReady);
 alertLevelRef.current=alertLevel;voiceLevelRef.current=voiceLevel;voiceReadyRef.current=voiceReady;
 useEffect(()=>{
  if(!desktop)return;
  let active=true;
  invoke('order_voice_status').then(ready=>{
   if(active)setVoiceReady(ready===true);
  }).catch(()=>{if(active)setVoiceReady(false)});
  return ()=>{active=false};
 },[desktop]);
 async function naturalVoiceOnly(){
  try {
   await invoke('play_order_voice',{level:voiceLevelRef.current});
   setVoiceReady(true);
   setSoundMessage('');
  }catch(error){
   setVoiceReady(false);
   setSoundMessage('Voz natural não configurada. Importe uma gravação WAV de voz brasileira profissional (16 bits PCM) para ativá-la.');
  }
 }
 async function importNaturalVoice(event){
  const file=event.target.files?.[0];
  if(!file)return;
  if(file.size>4000000||file.size<2048){setSoundMessage('Escolha uma gravação WAV de até 4 MB.');return;}
  try {
   const audioData=Array.from(new Uint8Array(await file.arrayBuffer()));
   await invoke('save_order_voice',{audioData});
   setVoiceReady(true);
   setSoundMessage('Voz natural salva neste computador. Use “Testar somente voz” para ouvi-la.');
  } catch(e){setSoundMessage('Não foi possível importar a voz WAV: '+String(e));}
  event.target.value='';
 }
 const observeOrders=useMemo(()=>newOrderTracker(storeId),[client,storeId,manager]);

 // Native process polls only IDs and survives minimized/suspended WebView.
 useEffect(()=>{
  if(!desktop||!manager||!storeId)return;
  let live=true;
  async function startWatch(){
   try{
    const {data,error}=await client.rpc('pitacco_windows_watch_start',{p_store:storeId});
    if(error)throw error;
    if(!live)return;
    await invoke('start_background_order_watch',{
     storeId,token:data,apiKey:client.supabaseKey,
     level:alertLevelRef.current,voiceLevel:voiceLevelRef.current,
     bell:bellChoiceRef.current
    });
   }catch(e){if(live)setError('Monitor de pedidos em segundo plano: '+(e.message||String(e)));}
  }
  void startWatch();
  const renew=()=>{if(live&&document.hasFocus())void startWatch()};
  window.addEventListener('focus',renew);
  return()=>{
   live=false;
   window.removeEventListener('focus',renew);
   void invoke('stop_background_order_watch',{storeId}).catch(()=>{});
   void Promise.resolve(client.rpc('pitacco_windows_watch_stop',{p_store:storeId})).catch(()=>{});
  };
 },[client,desktop,manager,storeId]);
 useEffect(()=>{
  if(!desktop||!manager||!storeId)return;
  void invoke('update_background_order_sound',{level:alertLevel,voiceLevel,bell:bellChoice}).catch(()=>{});
 },[desktop,manager,storeId,alertLevel,voiceLevel,bellChoice]);

 async function nativeOrderSound(onlyBell=false){
  try{
   if(onlyBell){
    await invoke('play_order_bell',{level:alertLevelRef.current,bell:bellChoiceRef.current});
   }else{
    // Windows plays the approved 2.38 s bell first, then the natural
    // offline WAV on a native worker thread (no throttled JS timeout).
    await invoke('play_order_alert_combo',{
     level:alertLevelRef.current,voiceLevel:voiceLevelRef.current,bell:bellChoiceRef.current
    });
   }
   setSoundMessage(onlyBell?'Teste do sino enviado ao Windows.':voiceReadyRef.current
    ?'Teste do sino e da voz enviado ao Windows.'
    :'Sino e voz oficiais acionados.');
  }catch(error){
   setSoundMessage('Falha ao reproduzir o alerta do Windows: '+String(error));
  }
 }
 useEffect(()=>()=>{if(audio.current)void audio.current.close().catch(()=>{});},[]);
 async function toggleOrderSound(){
  if(sound){
   const previous=audio.current;
   audio.current=null;setSound(false);setSoundMessage('');
   if(previous)await previous.close().catch(()=>{});
   return;
  }
  const Audio=window.AudioContext||window.webkitAudioContext;
  if(!Audio){setSoundMessage('Som indisponível neste navegador.');return;}
  try{
   audio.current??=new Audio();
   await audio.current.resume();
   if(audio.current.state!=='running')throw Error('som bloqueado');
   playOrderChime(audio.current);
   setSound(true);setSoundMessage('Som de pedidos ativado nesta aba.');
  }catch{setSoundMessage('Não foi possível ativar o som neste navegador.');}
 }
 const soundControl=<div className="dispatch-actions">
  <button type="button" className="secondary" aria-pressed={sound} onClick={toggleOrderSound}>
   {sound?'Desativar som de pedidos':'Ativar som de pedidos'}
  </button>
  {soundMessage&&<small role="status">{soundMessage}</small>}
 </div>;
 const [physicalPrintCheck,setPhysicalPrintCheck]=useState(null);
 const [physicalPrintFeedback,setPhysicalPrintFeedback]=useState('');
 useEffect(()=>{setPhysicalPrintCheck(null);setPhysicalPrintFeedback('')},[storeId,device]);
 const rpc=async(name,args)=>{const {data,error}=await client.rpc(name,args);if(error)throw error;return data};
 async function act(fn){setBusy(true);setError('');try{await fn()}catch(e){setError(e.message||String(e))}finally{setBusy(false)}}
 useEffect(()=>{
  if(!desktop)return;
  invoke('device_id').then(setDevice).catch(e=>setError(String(e)));
  invoke('list_printers').then(setPrinters).catch(e=>setError(String(e)));
  invoke('get_autostart').then(setAutoStart).catch(e=>setError(String(e)));
 },[desktop]);
 useEffect(()=>{
  if(!desktop||!storeId)return;
  let live=true;
  const activation={storeId:manager?storeId:null,ready:queueActiveStore(manager?storeId:null)};
  nativePrintScope.current=activation;
  activation.ready.catch(e=>{if(live)setError(String(e))});
  return()=>{live=false;if(nativePrintScope.current===activation)nativePrintScope.current=null;void queueActiveStore(null).catch(()=>{})};
 },[desktop,storeId,manager]);
 useEffect(()=>{
  if(!desktop||!storeId||!manager||!device)return;
  let live=true,running=false;
  async function heartbeat(){
   if(!live||running)return;
   running=true;
   try{
    const {error}=await client.rpc('pitacco_windows_ping',{p_store:storeId,p_device:device});
    if(error)throw error;
    void client.rpc('pitacco_control_device_ping',{p_store:storeId,p_device:device,p_app:'windows',p_version:packageInfo.version}).then(()=>{}).catch(()=>{});
   }catch(error){
    if(live)setError('Presença do aplicativo Windows indisponível: '+(error.message||String(error)));
   }finally{running=false}
  }
  void heartbeat();
  const interval=setInterval(heartbeat,30000);
  return()=>{live=false;clearInterval(interval)};
 },[client,desktop,device,storeId,manager]);
 useEffect(()=>{
  if(!desktop||!manager||!storeId)return;
  let stopped=false,running=false;
  async function readLocal(){
   if(running||stopped)return;running=true;
   try{if(!await waitForNativePrintStore()||stopped)return;const local=await invoke('list_jobs');if(stopped)return;setJobs(local.filter(j=>j.store_id===storeId));
    for(const job of local.filter(j=>j.store_id===storeId&&['error','uncertain'].includes(j.state))){const key=`${job.id}:${job.state}`;if(!notifySeen.current.has(key)){notifySeen.current.add(key);invoke('notify',{message:'Falha de impressão. Consulte a fila do Pitacco.'}).catch(()=>{});}}
   }catch(e){if(!stopped)setError('Fila local: '+String(e))}finally{running=false}
  }
  void readLocal();const timer=setInterval(readLocal,2000);return()=>{stopped=true;clearInterval(timer)};
 },[desktop,manager,storeId]);
 useEffect(()=>{
  if(!storeId||!manager)return;
  let stopped=false,running=false,refreshAgain=false;
     setDetail(null);notifySeen.current=new Set();setOrders([]);setOrderBadges([]);setJobs([]);setError('');
  let acknowledgedPrintStates=new Map();
  async function refresh(){
   if(stopped)return;if(running){refreshAgain=true;return}running=true;
   try{
    const results=await Promise.all([
     fetchDailyOrders(client,storeId),
     client.from('acceptance_settings').select('*').eq('store_id',storeId),
     client.from('print_sectors').select('*').eq('store_id',storeId).order('sector'),
     client.from('deliveries').select('*').eq('store_id',storeId).not('order_id','is',null),
     client.rpc('pitacco_store_couriers',{p_store:storeId}),
     client.rpc('pitacco_store_payment_summary',{p_store:storeId}),
     client.from('orders').select('*').eq('store_id',storeId).eq('status','pending').not('scheduled_release_at','is',null).order('scheduled_release_at').limit(100),
     client.rpc('pitacco_merchant_order_badges',{p_store:storeId})
    ]);
    const scheduleError=results[6].error;
    const scheduleColumnMissing=['42703','PGRST204'].includes(scheduleError?.code)
     && scheduleError.message?.includes('scheduled_release_at');
    if(results[0].error)throw results[0].error;
    if(stopped)return;
    const incoming=[...new Map([...results[0].data||[],...results[6].data||[]].map(order=>[order.id,order])).values()];
    // Resolve every visible order's delivery even when the legacy store-wide query reaches its row cap.
    const linked=new Map((results[3].data||[]).map(d=>[d.id,d]));
    const known=new Set([...linked.values()].map(d=>d.order_id));
    const missing=incoming.filter(o=>!known.has(o.id)&&o.receipt?.logistics!=='retirada').map(o=>o.id);
    for(let i=0;i<missing.length;i+=150){
     const extra=await client.from('deliveries').select('*').eq('store_id',storeId).in('order_id',missing.slice(i,i+150));
     if(extra.error)throw extra.error;for(const d of extra.data||[])linked.set(d.id,d);
    }
    if(stopped)return;results[3].data=[...linked.values()];
    const scoped=incoming.filter(order=>order.store_id===storeId);
    const fresh=observeOrders(scoped);
    const supplemental=results.slice(1).some((result,index)=>result.error&&!(index===5&&scheduleColumnMissing));
    setOrders(scoped);
    if(!results[5].error)setPaymentSummary(results[5].data||[]);
    if(!results[7].error)setOrderBadges(results[7].data||[]);
    if(!results[3].error)setDeliveryRows(results[3].data||[]);
    if(!results[4].error)setCourierRows(results[4].data||[]);
    if(!results[1].error)setSettings(results[1].data||[]);
    if(!results[2].error)setSectors(results[2].data||[]);
    setStatus(supplemental?'Pedidos sincronizados · dados complementares pendentes':'Conectado · sincronização ativa');
    if(fresh.length){
     if(desktop){
      if(document.hasFocus()){
       void nativeOrderSound();
      invoke('notify_new_order',{message:fresh.length===1?'Você tem um novo pedido.':`${fresh.length} novos pedidos na sua loja.`}).catch(()=>{});
      }
     }else if(audio.current?.state==='running'){
      playOrderChime(audio.current);
      sayNewOrder();
     }
    }
    if(desktop&&device&&await waitForNativePrintStore()&&!stopped){
     // Printing is a separate subsystem. A duplicate local job, missing
     // binding or disconnected printer must not mark order sync as failed.
     try{
      const remote=await rpc('claim_print_jobs',{p_store:storeId,p_device:device});
      if(stopped)return;
      await ingestJobs({jobs:remote||[],device,call:invoke,ack:args=>rpc('ack_print_job',args),storeName,client,storeLogoPath});
      const local=await invoke('list_jobs');
      if(stopped)return;
      const storeJobs=local.filter(j=>j.store_id===storeId);
      setJobs(storeJobs);
      const acknowledgedThisPoll=new Map();
      for(const job of storeJobs){
       if(['submitted','error','uncertain'].includes(job.state)){
        try{
         if(stopped)return;
         const state=JSON.stringify([job.state,job.error||null]);
         if(acknowledgedPrintStates.get(job.id)!==state){
          await rpc('ack_print_job',{p_job:job.id,p_device:device,p_state:job.state,p_error:job.error||null});
         }
         acknowledgedThisPoll.set(job.id,state);
        }catch(ackError){
         setError('Confirmação de impressão pendente: '+String(ackError?.message||ackError));
        }
        const key=`${job.id}:${job.state}`;
        if(job.state!=='submitted'&&!notifySeen.current.has(key)){
         notifySeen.current.add(key);
         invoke('notify',{message:'Falha de impressão. Consulte a fila do Pitacco.'}).catch(()=>{});
        }
       }
      }
      acknowledgedPrintStates=acknowledgedThisPoll;
     }catch(printError){
      if(!stopped){
       setStatus('Pedidos sincronizados · impressão pendente');
       setError('Impressão: '+String(printError?.message||printError));
      }
     }
    }
   }catch(e){if(!stopped){setStatus('Sincronização pendente · nova tentativa automática');setError(e.message||String(e));}}
   finally{running=false;if(refreshAgain&&!stopped){refreshAgain=false;void refresh()}}
  }
  void refresh();const timer=setInterval(refresh,5000);
  let channel;
  try{
   channel=client.channel(`operations:${storeId}`);
   channel.on('postgres_changes',{event:'*',schema:'public',table:'orders',filter:`store_id=eq.${storeId}`},refresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'deliveries',filter:`store_id=eq.${storeId}`},refresh)
    .subscribe(state=>{if(state==='SUBSCRIBED')void refresh()});
  }catch{
   // The interval continues syncing orders when this browser blocks Realtime.
  }
  return()=>{
   stopped=true;clearInterval(timer);
   if(channel)void client.removeChannel(channel).catch(()=>{});
  };
 },[client,storeId,device,desktop,manager]);
 async function decideFiado(order,approved){
  if(!manager||!storeId||order?.source!=='proprio'||order?.receipt?.payment!=='fiado')return;
  if(!window.confirm(approved?'Autorizar o pagamento fiado deste pedido?':'Recusar o Fiado e cancelar este pedido?'))return;
  await act(async()=>{
   await rpc('pitacco_fiado_approve',{p_store:storeId,p_order:order.id,p_approve:approved});
   setOrders(current=>current.map(o=>o.id===order.id?
    {...o,status:approved?o.status:'rejected',receipt:{...o.receipt,fiado_approval:approved?'approved':'rejected'}}:o));
  });
 }
 async function runWindowsPhysicalTest(sector){
  if(!desktop||!device||!manager)return setError('Abra o aplicativo Windows e entre na sua loja para executar o teste.');
  await act(async()=>{
   setPhysicalPrintCheck(null);setPhysicalPrintFeedback('');
   const {receipt,warnings}=await buildPhysicalReceiptTest({client,storeId,storeName,storeLogoPath,width:Number(sector.width)});
   const result=await invoke('test_printer',{printerName:sector.printer,width:Number(sector.width),receipt});
   setStatus([String(result),...warnings].join(' '));
   const {data,error}=await client.rpc('pitacco_windows_print_check_started',{
    p_store:storeId,p_device:device,p_printer:sector.printer,p_width:Number(sector.width)
   });
   if(error){
    setPhysicalPrintFeedback('O Windows enviou o teste ao spooler, mas não foi possível registrar o resultado no servidor. '+error.message);
    return;
   }
   if(!data?.test_id)throw Error('O Windows enviou o teste, mas o registro do servidor não foi confirmado.');
   setPhysicalPrintCheck({id:data.test_id,printer:sector.printer,width:sector.width,storeId});
  });
 }
 async function confirmWindowsPhysicalTest(outcome){
  if(!desktop||!physicalPrintCheck||physicalPrintCheck.storeId!==storeId)return;
  await act(async()=>{
   await rpc('pitacco_windows_print_check_confirm',{
    p_store:storeId,p_test:physicalPrintCheck.id,p_outcome:outcome
   });
   setPhysicalPrintFeedback(outcome==='printed'
    ?'Confirmação registrada pelo operador: o cupom saiu no papel. Isso não valida a impressão automática após o aceite.'
    :outcome==='failed'
    ?'Operador registrou que não houve impressão física. Verifique papel, driver, cabo, spooler e impressora selecionada.'
    :'Resultado incerto. Confira o spooler e o papel antes de realizar um novo teste.');
   setPhysicalPrintCheck(null);
  });
 }
 async function saveMode(source,mode,enabled){const {error}=await client.from('acceptance_settings').upsert({store_id:storeId,source,mode,enabled},{onConflict:'store_id,source'});if(error)throw error;setSettings(old=>[...old.filter(s=>s.source!==source),{source,mode,enabled}])}
 async function savePrinter(e){e.preventDefault();const form=e.currentTarget,f=new FormData(form);await act(async()=>{const {error}=await client.from('print_sectors').upsert({store_id:storeId,sector:String(f.get('sector')).trim(),printer:String(f.get('printer')).trim(),width:Number(f.get('width')),copies:Number(f.get('copies')),enabled:true,sources:printerSources.split(',').map(x=>x.trim()).filter(Boolean),categories:printerCategories.split(',').map(x=>x.trim()).filter(Boolean)},{onConflict:'store_id,sector'});if(error)throw error;form.reset();setEditingSector(null);setSectors(old=>[...old.filter(x=>x.sector!==String(f.get('sector')).trim()),{store_id:storeId,sector:String(f.get('sector')).trim(),printer:String(f.get('printer')).trim(),width:Number(f.get('width')),copies:Number(f.get('copies')),enabled:true}])})}
 async function refreshPrintDevice(){if(!storeId)return;const {data,error}=await client.from('print_devices').select('device_id,bound_at').eq('store_id',storeId).maybeSingle();if(error)throw error;setBoundDevice(data);setDeviceBound(!!data&&data.device_id===device)}
 useEffect(()=>{if(!storeId||!device||!manager)return;refreshPrintDevice().catch(e=>setError(e.message))},[client,storeId,device,manager]);
 async function bindComputer(){if(boundDevice?.device_id&&boundDevice.device_id!==device&&!window.confirm('Esta loja já possui outro computador vinculado. Deseja transferir a impressão para este computador? O anterior deixará de receber novos pedidos.'))return;await act(async()=>{await rpc('pitacco_switch_print_device',{p_store:storeId,p_device:device});await refreshPrintDevice();setPrintMessage('Computador vinculado com sucesso.')})}
 async function unbindComputer(){if(!window.confirm('Desvincular este computador? A impressão automática ficará indisponível até vincular outro.'))return;await act(async()=>{await rpc('pitacco_unbind_print_device',{p_store:storeId,p_device:device});await refreshPrintDevice();setPrintMessage('Computador desvinculado.')})}
 async function createOrder(e){e.preventDefault();const form=e.currentTarget,f=new FormData(form);await act(async()=>{const q=Number(f.get('quantity')),p=Number(f.get('price'));await rpc('create_operational_order',{p_store:storeId,p_request:(createRequest.current??=operationRequestId()),p_customer:f.get('customer'),p_address:f.get('address'),p_items:[{name:f.get('item'),quantity:q,unit_price:p,modifiers:String(f.get('modifiers')||'').split(',').map(s=>s.trim()).filter(Boolean)}],p_total:q*p,p_notes:f.get('notes'),p_payment:f.get('payment'),p_logistics:f.get('logistics')});createRequest.current=null;form.reset()})}
 async function registerPayment(e){e.preventDefault();if(!paymentOrder)return;await act(async()=>{const amount=Number(paymentAmount.replace(',','.'));if(!Number.isFinite(amount)||amount<=0)throw Error('Informe um valor válido.');await rpc('pitacco_record_payment',{p_order:paymentOrder.id,p_request:(paymentRequest.current??=operationRequestId()),p_amount:amount,p_method:paymentMethod,p_reference:paymentReference.trim()||null});paymentRequest.current=null;const data=await rpc('pitacco_store_payment_summary',{p_store:storeId});setPaymentSummary(data||[]);setPaymentOrder(null);setPaymentAmount('');setPaymentReference('')})}
 async function reprint(orderId){setPrintRequestFeedback('');const key=orderId;if(!reprintRequests.current.has(key))reprintRequests.current.set(key,operationRequestId());await rpc('reprint_order',{p_order:orderId,p_request:reprintRequests.current.get(key),p_reason:'Reimpressão solicitada pelo botão do pedido'});reprintRequests.current.delete(key);setPrintRequestFeedback('Comanda solicitada à fila do Pitacco. O envio não confirma impressão física; confira o papel da impressora.');}
 function printBrowserOrder(order){
  try{openBrowserPrint(order,visibleOrderNo(order));}
  catch(err){setError('Impressão manual: '+(err.message||String(err)))}
 }
 const orderBadge=o=>orderBadges.find(b=>b.order_id===o?.id);
 const visibleOrderNo=o=>publicOrderNumber(o,orderBadge(o));
 const stage=o=>orderStage(o,deliveryRows.find(d=>d.order_id===o.id));
 const filtered=orders.filter(o=>matchesOrder(o,query));
 const waiting=orders.filter(o=>o.status==='pending'&&stage(o)==='analysis');
 const preparing=orders.filter(o=>stage(o)==='preparing');
 const ready=orders.filter(o=>stage(o)==='ready');
 const printAlerts=jobs.filter(j=>['error','uncertain'].includes(j.state));
 const visible=view==='Pedidos'||view==='Cozinha e expedição'||view==='Configurações'||view==='Fideliza+';
 return <>
 {manager&&!desktop&&['Painel','Pedidos'].includes(view)&&soundControl}
 <section className={"pitacco-operations pitacco-operations--"+(view==="Configurações"?"printing":"orders")} hidden={!visible} aria-label={view==='Pedidos'?'Central de pedidos':'Configurações da operação'}>
 {view==='Fideliza+'&&<Fideliza client={client} storeId={storeId} manager={manager} initialSection={navigationSection||'Visão geral'} navigationKey={navigationKey}/>}
 {manager&&desktop&&view==='Configurações'&&settingsTab==='Alertas e aplicativo'&&
 <section className="panel pitacco-windows-audio-controls" aria-label="Alertas sonoros do Pitacco Windows">
  <h3>Som de novo pedido</h3>
  <p>Escolha um dos cinco sinos. A voz oficial é sempre a mesma: “Pitacco! Você tem um novo pedido.”</p>
  <label className="field" htmlFor="pitacco-bell-choice">Sino da loja
   <select id="pitacco-bell-choice" value={bellChoice} onChange={event=>{
    const next=event.target.value;setBellChoice(next);
    try{localStorage.setItem('pitacco:bell-choice:'+storeId,next)}catch{}
   }}>
    <option value="original">Pitacco Original</option>
    <option value="moderno">Moderno</option>
    <option value="classico">Clássico</option>
    <option value="duplo">Duplo</option>
    <option value="intenso">Intenso</option>
   </select>
  </label>
  <div className="quick-actions">
   <button type="button" onClick={()=>void nativeOrderSound(true)}>Ouvir sino</button>
   <button type="button" className="secondary" onClick={()=>void nativeOrderSound()}>Testar sino + voz</button>
  </div>
  <label className="field" htmlFor="pitacco-audio-bell-volume">Volume do sino
   <select id="pitacco-audio-bell-volume" value={alertLevel} onChange={event=>{
    const next=Number(event.target.value);setAlertLevel(next);
    try{localStorage.setItem('pitacco:native-alert-volume:'+storeId,String(next))}catch{}
   }}>
    <option value={1}>Discreto</option><option value={2}>Alto</option><option value={3}>Máximo</option>
   </select>
  </label>
  <label className="field" htmlFor="pitacco-audio-voice-volume">Volume da voz oficial
   <select id="pitacco-audio-voice-volume" value={voiceLevel} onChange={event=>{
    const next=Number(event.target.value);setVoiceLevel(next);
    try{localStorage.setItem('pitacco:natural-voice-level:'+storeId,String(next))}catch{}
   }}>
    <option value={1}>Original</option><option value={2}>Alto</option><option value={3}>Máximo</option>
   </select>
  </label>
  <p role="status">Voz natural já incluída no Pitacco Windows. Nenhuma importação é necessária.</p>
  {soundMessage&&<p role="status">{soundMessage}</p>}
 </section>}
{!(desktop&&view==='Pedidos')&&<div className="connection-bar"><span className="status-dot"/>{status}<span className="badge neutral">{desktop?'Aplicativo Windows':'Painel web'}</span></div>}
 {error&&(!String(error).startsWith('Impressão:')||view==='Configurações')&&<p role="alert" className="notice error">{error}</p>}{!manager&&<div className="panel">Solicite acesso de gestor para operar pedidos e configurações.</div>}
 {manager&&!desktop&&view==='Pedidos'&&navigationSection!=='history'&&<WindowsConnectionStatus client={client} storeId={storeId} onNavigate={onNavigate} compact/>}
 {manager&&view==='Pedidos'&&printRequestFeedback&&<p role="status" className="notice">{printRequestFeedback}</p>}
 {manager&&view==='Pedidos'&&navigationSection==='history'&&<OrderHistory key={storeId} client={client} storeId={storeId}/>}
 {manager&&view==='Pedidos'&&navigationSection!=='history'&&<Pedidos merchantLayout={!desktop} client={client} storeId={storeId} orders={orders} popupLayout={desktop} deliveries={deliveryRows} couriers={courierRows} badges={orderBadges} acceptMode={settings.find(s=>s.source==='ifood'&&s.enabled)?.mode||'manual'} dispatchMode={dispatchPolicy} stage={stage} busy={busy} actionError={error} onAccept={id=>act(()=>rpc('accept_order',{p_order:id}))} onAcceptIfood={id=>act(async()=>{
 const {data,error}=await client.functions.invoke('ifood-manual-action',{body:{action:'accept',order_id:id}});
 if(error){
  let message=error.message||'Não foi possível enviar o aceite ao iFood.';
  try{const details=await error.context?.json();if(details?.error)message=details.error;}catch{}
  throw Error(message);
 }
 if(data?.status!=='requested'&&data?.status!=='already_requested')throw Error('Aceite não confirmado pelo servidor Pitacco.');
 setOrders(rows=>rows.map(order=>order.id===id?{...order,receipt:{...order.receipt,ifood_manual_accept:'requested'}}:order));
})} onGetIfoodReasons={async id=>{
 const {data,error}=await client.functions.invoke('ifood-manual-action',{body:{action:'reasons',order_id:id}});
 if(error){
  let message=error.message||'Não foi possível consultar os motivos.';
  try{const details=await error.context?.json();if(details?.error)message=details.error;}catch{}
  throw Error(message);
 }
 return Array.isArray(data?.reasons)?data.reasons:[];
}} onRejectIfood={async(id,reason)=>{
 setBusy(true);setError('');
 try{
  const {data,error}=await client.functions.invoke('ifood-manual-action',{body:{action:'cancel',order_id:id,reason}});
  if(error){
   let message=error.message||'Não foi possível solicitar o cancelamento no iFood.';
   try{const details=await error.context?.json();if(details?.error)message=details.error;}catch{}
   throw Error(message);
  }
  if(data?.status!=='requested'&&data?.status!=='already_requested')throw Error('O iFood não recebeu a solicitação de cancelamento.');
  setOrders(rows=>rows.map(order=>order.id===id?{...order,receipt:{...order.receipt,ifood_manual_cancel:'requested'}}:order));
  return true;
 }catch(e){setError(e.message||String(e));return false;}
 finally{setBusy(false);}
}} onDecision={async(id,status,reason)=>{setBusy(true);setError('');try{if(status==='cancelled')await rpc('pitacco_cancel_active_order',{p_order:id,p_reason:reason});else await rpc('pitacco_decide_pending_order',{p_order:id,p_status:status,p_reason:reason});setOrders(rows=>rows.map(order=>order.id===id?{...order,status}:order));return true}catch(e){setError(e.message||String(e));return false}finally{setBusy(false)}}} onReady={id=>act(()=>rpc('set_order_preparation',{p_order:id,p_status:'ready'}))} onPickup={id=>act(()=>rpc('set_order_preparation',{p_order:id,p_status:'completed'}))} onConclude={id=>act(()=>rpc('pitacco_manager_confirm_verified_delivery',{p_order:id}))} onDetail={o=>{setDispatchOnly(false);setDetail(o)}} onAssign={o=>{setDispatchOnly(true);setDetail(o)}} onReprint={id=>{if(desktop){void act(()=>reprint(id));return;}const order=orders.find(o=>o.id===id);if(order)printBrowserOrder(order);}} manualPrint={!desktop}/>}
 {manager&&view==='Cozinha e expedição'&&navigationSection==='new-order'&&<MerchantNewOrder key={storeId} client={client} storeId={storeId} onNavigate={onNavigate}/>}
 {manager&&view==='Cozinha e expedição'&&navigationSection!=='new-order'&&<>
 <div className="orders-toolbar"><div className="view-switch"><button className={orderFilter==='board'?'active':''} onClick={()=>setOrderFilter('board')}>Quadro de pedidos</button><button className={orderFilter==='completed'?'active':''} onClick={()=>setOrderFilter('completed')}>Concluídos</button></div><input aria-label="Buscar pedido" placeholder="Buscar nome, telefone ou código" value={query} onChange={e=>setQuery(e.target.value)}/><button onClick={()=>{const el=document.getElementById('new-order');el.open=!el.open;if(el.open)el.querySelector('input')?.focus()}}>+ Nova venda</button></div>
 <details id="new-order" className="panel order-create"><summary>Registrar venda no balcão</summary><p>Registre o atendimento da loja. O pagamento é apenas informado; nenhuma cobrança online é realizada.</p><form onSubmit={createOrder}><label className="field">Cliente<input name="customer" placeholder="Cliente" required maxLength={150}/></label><label className="field">Endereço / retirada<input name="address" placeholder="Endereço / retirada" required maxLength={500}/></label><label className="field">Produto<input name="item" placeholder="Produto" required maxLength={200}/></label><label className="field">Quantidade<input name="quantity" aria-label="Quantidade" type="number" min="1" max="100" defaultValue="1" required/></label><label className="field">Preço unitário<input name="price" placeholder="Preço unitário" type="number" step="0.01" min="0.01" required/></label><label className="field">Complementos separados por vírgula<input name="modifiers" placeholder="Complementos separados por vírgula"/></label><label className="field">Observações<input name="notes" placeholder="Observações"/></label><label className="field">Forma de pagamento<select name="payment"><option value="dinheiro">Dinheiro</option><option value="pix">Pix (registrar, sem cobrança)</option><option value="cartao">Cartão (registrar, sem cobrança)</option></select></label><label className="field">Entrega ou retirada<select name="logistics"><option value="loja">Entrega própria</option><option value="retirada">Retirada</option></select></label><button disabled={busy}>Criar pedido</button></form></details>

 {desktop&&!sectors.some(s=>s.enabled)&&<div className="notice">Configure um setor de impressão no Pitacco Windows antes de utilizar a impressão automática. <button className="linkbutton" onClick={()=>onNavigate('Configurações')}>Configurar impressora</button></div>}
 {!desktop&&<p className="hint">No navegador, a impressão da comanda é manual: após aceitar o pedido, clique em Imprimir no navegador e escolha a impressora na janela do sistema. O Pitacco não imprime automaticamente pelo site.</p>}
 <div className={'kanban '+(orderFilter==='completed'?'history-board':'')}>{(orderFilter==='completed'?[['completed','Concluídos']]:view==='Cozinha e expedição'?columns.filter(([key])=>['preparing','ready'].includes(key)):columns).map(([id,label])=>{const items=filtered.filter(o=>stage(o)===id);return <section className={'kanban-column '+id} key={id}><div className="column-header"><div><h3>{label}</h3><span>{items.length}</span></div><small>{currency(items.reduce((total,o)=>total+Number(o.gross),0))}</small></div><div className="column-body">{items.map(o=><article className="order-card" key={o.id}><div className="card-heading"><b>#{visibleOrderNo(o)}</b><span className="order-time">{new Date(o.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span>{o.status==='accepted'&&(desktop
 ?<button type="button" className="order-print-button" title="Reimprimir comanda pelo Windows" aria-label={"Reimprimir comanda do pedido "+visibleOrderNo(o)} disabled={busy} onClick={()=>act(()=>reprint(o.id))}><Printer size={18} aria-hidden="true"/></button>
 :<button type="button" className="order-print-button" title="Imprimir manualmente pelo navegador" aria-label={"Imprimir no navegador pedido "+visibleOrderNo(o)} onClick={()=>printBrowserOrder(o)}><Printer size={18} aria-hidden="true"/></button>)}</div>{validLocalizer(orderBadge(o))&&<div className="operations-order-localizer"><small>LOCALIZADOR DE LIGAÇÃO</small><strong>{validLocalizer(orderBadge(o))}</strong></div>}<h3>{o.receipt?.customer||'Cliente'}</h3><p>{SOURCES.find(([source])=>source===o.source)?.[1]||o.source} · {o.receipt?.logistics==='retirada'?'Retirada':'Entrega'}</p><div className="order-items">{receiptItems(o.receipt).map((item,i)=><div key={i}>{item.quantity} × {item.name}</div>)}</div><div className="card-payment"><strong>{currency(o.gross)}</strong><span className={o.source==='proprio'&&paymentSummary.some(p=>p.order_id===o.id&&Number(p.remaining)<=0.005)?'payment-paid':''}>{o.receipt?.payment||'Pagamento não informado'} · {(()=>{const p=paymentSummary.find(p=>p.order_id===o.id);return p&&Number(p.remaining)<=0.005?'Pedido pago':p&&Number(p.paid)>0?'Parcial: '+currency(p.paid):'A receber'})()}</span></div>{o.source==='proprio'&&o.receipt?.payment!=='fiado'&&!(paymentSummary.some(p=>p.order_id===o.id&&Number(p.remaining)<=0.005))&&<button className="secondary" disabled={busy} onClick={()=>{const p=paymentSummary.find(p=>p.order_id===o.id);setPaymentOrder(o);setPaymentAmount(String(Number(p?.remaining??o.gross).toFixed(2)));setPaymentReference('')}}>Registrar recebimento</button>}<div className="logistics-state"><small>Preparo: {o.preparation_status==='ready'?'pronto':o.preparation_status==='completed'?'finalizado (não significa entregue)':o.status==='pending'?'aguardando aceite':'em preparo'}</small>{o.source==='ifood'&&o.receipt?.ifood_status==='CONCLUDED'&&<small role="status">iFood encerrou o pedido (evento recebido). {deliveryRows.find(d=>d.order_id===o.id)?.status==='entregue'?'Entrega registrada.':'Entrega no Pitacco ainda sem conclusão validada.'}</small>}<small>{o.receipt?.logistics==='retirada'?'Retirada no balcão':deliveryLabel(deliveryRows.find(d=>d.order_id===o.id))}</small>{courierRows.find(c=>c.id===deliveryRows.find(d=>d.order_id===o.id)?.courier_id)?.name}</div><button className="linkbutton" onClick={()=>{setDispatchOnly(false);setDetail(o)}}>Detalhes e entrega</button><div className="order-actions">{id==='analysis'&&o.status==='pending'&&o.source==='proprio'&&o.receipt?.payment==='fiado'&&o.receipt?.fiado_approval==='pending'&&<>
 <p className="fiado-order-pending" role="status">Fiado aguardando autorização da loja. O pedido não pode entrar em preparo.</p>
 <button disabled={busy} onClick={()=>decideFiado(o,true)}>Autorizar Fiado</button>
 <button className="secondary" disabled={busy} onClick={()=>decideFiado(o,false)}>Recusar Fiado</button>
 </>}
 {id==='analysis'&&o.source==='proprio'&&!(o.receipt?.payment==='fiado'&&o.receipt?.fiado_approval==='pending')&&<button disabled={busy} onClick={()=>act(()=>rpc('accept_order',{p_order:o.id}))}>Aceitar e iniciar preparo</button>}
{id==='analysis'&&o.source==='ifood'&&o.status==='pending'&&<button disabled={busy||settings.some(x=>x.source==='ifood'&&x.enabled&&x.mode==='automatic')||o.receipt?.ifood_manual_accept==='requested'} onClick={()=>act(async()=>{
 const {data,error}=await client.functions.invoke('ifood-manual-action',{body:{action:'accept',order_id:o.id}});
 if(error)throw error;
 if(data?.status!=='requested'&&data?.status!=='already_requested')throw Error('O aceite ainda não foi confirmado pelo servidor');
 setOrders(rows=>rows.map(x=>x.id===o.id?{...x,receipt:{...x.receipt,ifood_manual_accept:'requested'}}:x));
})}>Aceitar pedido no iFood</button>}{id==='preparing'&&o.status==='accepted'&&<button className="dispatch-highlight" disabled={busy} onClick={()=>act(()=>rpc('set_order_preparation',{p_order:o.id,p_status:'ready'}))}>Marcar pedido pronto</button>}{id==='ready'&&(o.source==='proprio'&&o.receipt?.logistics==='retirada'?<button disabled={busy} onClick={()=>act(()=>rpc('set_order_preparation',{p_order:o.id,p_status:'completed'}))}>Confirmar retirada</button>:deliveryRows.some(d=>d.order_id===o.id&&d.logistics_provider==='loja'&&d.status==='pendente'&&!d.courier_id)?<button className="dispatch-highlight" disabled={busy} onClick={()=>{setDispatchOnly(true);setDetail(o)}}>Selecionar entregador</button>:deliveryRows.some(d=>d.order_id===o.id&&d.courier_id)?<span role="status">Entregador selecionado · aguardando saída</span>:<span role="status">Aguardando coleta ou saída</span>)}
{id==='delivery'&&o.source==='proprio'&&<button className="dispatch-highlight" disabled={busy} onClick={()=>act(()=>rpc('pitacco_manager_confirm_verified_delivery',{p_order:o.id}))}>Concluir entrega</button>}
{id==='delivery'&&<button className="secondary" disabled={busy} onClick={()=>{setDispatchOnly(false);setDetail(o)}}>Acompanhar entrega</button>}</div></article>)}{!items.length&&<div className="column-empty">Nenhum pedido nesta etapa</div>}</div></section>})}</div><p className="hint">Novo → Em preparo → Pronto → Em entrega → Concluído. Selecionar o entregador não confirma a saída: o motoboy registra a coleta e a entrega pelo aplicativo, e o marketplace confirma seus próprios eventos.</p>

 </>}
 {manager&&view==='Configurações'&&<>
 <div hidden={desktop&&!!navigationSection} className="tabs" aria-label="Seções de configuração">{['Impressoras','Aceite de pedidos','Alertas e aplicativo'].map(name=><button key={name} className={settingsTab===name?'active':''} aria-pressed={settingsTab===name} onClick={()=>setSettingsTab(name)}>{name}</button>)}</div>
 {settingsTab==='Impressoras'&&(
 desktop?<div className="merchant-print-layout">


 <div className="panel"><h3>Computador responsável pela impressão</h3><p>Somente um computador pode estar vinculado a cada loja por vez. A troca é protegida contra trabalhos pendentes.</p>{desktop?<><p><b>Status:</b> {deviceBound?'Este computador está vinculado':boundDevice?'Outro computador está vinculado':'Nenhum computador vinculado'}</p><div className="quick-actions"><button disabled={busy||!device||deviceBound} onClick={bindComputer}>{boundDevice&&!deviceBound?'Transferir vínculo para este computador':'Vincular este computador'}</button>{deviceBound&&<button className="secondary" disabled={busy} onClick={unbindComputer}>Desvincular computador</button>}</div><details className="technical"><summary>Identificação técnica do computador</summary><code>{device||'Carregando…'}</code></details></>:<p>Abra o aplicativo Windows para gerenciar o vínculo deste computador.</p>}</div>
    
<div className="panel"><h3>Impressoras por setor</h3><p>Instale a impressora no Windows. USB, rede e Bluetooth usam a fila do driver; o modelo deve aceitar ESC/POS RAW. Configure antes de aceitar pedidos.</p><form key={editingSector?.sector||'new'} onSubmit={savePrinter}><label className="field">Origens (separadas por vírgula, vazio = todas)<input value={printerSources} onChange={e=>setPrinterSources(e.target.value)} placeholder="proprio,ifood,99food,keeta"/></label><label className="field">Categorias dos produtos (separadas por vírgula, vazio = todas)<input value={printerCategories} onChange={e=>setPrinterCategories(e.target.value)} placeholder="Bebidas,Sobremesas"/></label><label className="field">Setor (ex.: cozinha)<input name="sector" defaultValue={editingSector?.sector||""} readOnly={!!editingSector} placeholder="Setor (ex.: cozinha)" maxLength={80} required/></label><label className="field">Nome exato da impressora no Windows<input name="printer" defaultValue={editingSector?.printer||""} list="windows-printers" placeholder="Nome exato da impressora no Windows" maxLength={200} required/></label><datalist id="windows-printers">{printers.map(p=><option key={p} value={p}/>)}</datalist><label className="field">Largura do papel<select name="width" aria-label="Largura" defaultValue={editingSector?.width||80}><option value="80">80 mm</option><option value="58">58 mm</option></select></label><label className="field">Vias<input name="copies" aria-label="Vias" type="number" min="1" max="5" defaultValue={editingSector?.copies||1} required/></label><button disabled={busy}>{editingSector?"Salvar alterações":"Adicionar impressora"}</button>{editingSector&&<button type="button" className="secondary" onClick={()=>setEditingSector(null)}>Cancelar edição</button>}</form>{printMessage&&<p role="status">{printMessage}</p>}{sectors.map(s=><div className="line" key={s.sector}><b>{s.sector}</b><span>{s.printer} · {s.width} mm · {s.copies} via(s)</span><button className="secondary" disabled={busy} onClick={()=>{setEditingSector(s);setPrinterSources((s.sources||[]).join(','));setPrinterCategories((s.categories||[]).join(','))}}>Editar</button><button className="secondary" disabled={busy} onClick={()=>act(async()=>{if(!window.confirm('Excluir a configuração do setor '+s.sector+'?'))return;const {count,error:pendingError}=await client.from('print_jobs').select('id',{count:'exact',head:true}).eq('store_id',storeId).eq('sector',s.sector).in('state',['pending','claimed','saved','uncertain','error']);if(pendingError)throw pendingError;if(count>0)throw new Error('Existem '+count+' trabalhos pendentes ou incertos neste setor. Reassocie ou resolva esses trabalhos antes de excluir a impressora.');const {error}=await client.from('print_sectors').delete().eq('store_id',storeId).eq('sector',s.sector);if(error)throw error;setSectors(old=>old.filter(x=>x.sector!==s.sector));if(editingSector?.sector===s.sector)setEditingSector(null)})}>Excluir</button><button disabled={busy} onClick={()=>act(async()=>{const {error}=await client.from('print_sectors').update({enabled:!s.enabled}).eq('store_id',storeId).eq('sector',s.sector);if(error)throw error})}>{s.enabled?'Desativar':'Ativar'}</button></div>)}</div>
   <WindowsReceiptPreview key={storeId} client={client} storeId={storeId} storeLogoPath={storeLogoPath} storeName={storeName} initialWidth={Number(sectors[0]?.width)===58?58:80}/>
   
   <section className="panel" aria-label="Teste físico de impressora no Windows">
     <h3>Teste de impressão física</h3>
     <p>Imprima um pedido fictício com as preferências salvas da loja: fonte, logo, QR Code, complementos, valores e troco. Nenhuma venda será registrada. Confira o papel antes de confirmar o resultado.</p>
     {sectors.map(sector=><div className="line" key={'test:'+sector.sector}>
       <b>{sector.sector}</b>
       <span>{sector.printer} · {sector.width} mm</span>
       <button type="button" disabled={busy||!device} onClick={()=>runWindowsPhysicalTest(sector)}>Testar impressão</button>
     </div>)}
     {!sectors.length&&<p>Cadastre uma impressora acima para testar.</p>}
     {physicalPrintCheck&&<div className="windows-print-confirmation" aria-label="Confirmar impressão física">
       <h4>O cupom de teste saiu no papel?</h4>
       <p>Impressora: {physicalPrintCheck.printer} · {physicalPrintCheck.width} mm. Confira o papel antes de responder.</p>
       <div className="quick-actions">
        <button type="button" disabled={busy} onClick={()=>confirmWindowsPhysicalTest('printed')}>Sim, imprimiu no papel</button>
        <button type="button" className="secondary" disabled={busy} onClick={()=>confirmWindowsPhysicalTest('failed')}>Não imprimiu</button>
        <button type="button" className="secondary" disabled={busy} onClick={()=>confirmWindowsPhysicalTest('uncertain')}>Não tenho certeza</button>
       </div>
     </div>}
     {physicalPrintFeedback&&<p role="status">{physicalPrintFeedback}</p>}
   </section>
 </div>:<>
  <WindowsConnectionStatus client={client} storeId={storeId} onNavigate={onNavigate}/>
  <section className="panel" aria-label="Impressão manual no navegador">
   <h3>Impressão manual no navegador</h3>
   <p>Após aceitar um pedido em Pedidos, clique em <strong>Imprimir no navegador</strong>.
    O navegador abre sua janela de impressão e permite escolher uma impressora instalada
    e reconhecida pelo sistema operacional.</p>
   <p>A página não descobre nomes de impressoras, não imprime automaticamente e
    não confirma a saída do papel. O teste físico da impressora e o envio automático
    ao spooler são exclusivos do aplicativo Windows.</p>
   <button type="button" className="secondary" onClick={()=>onNavigate('Pedidos')}>Ir para pedidos</button>
  </section>
 </>
 )}
 {settingsTab==='Aceite de pedidos'&&<>   <div className="panel"><h3>Aceite por origem</h3><p>Integrações de marketplaces ainda dependem de credenciais e homologação. Selecionar automático não confirma pedidos sem resposta oficial.</p>{SOURCES.map(([source,label])=>{const s=settings.find(s=>s.source===source)||{mode:'manual',enabled:false};return <div className="line" key={source}><b>{label}</b><select aria-label={`Modo ${label}`} disabled={busy} value={s.mode} onChange={e=>act(()=>saveMode(source,e.target.value,s.enabled))}><option value="manual">Manual</option><option value="automatic">Automático</option></select><label><input type="checkbox" checked={s.enabled} disabled={busy} onChange={e=>act(()=>saveMode(source,s.mode,e.target.checked))}/> Habilitado</label></div>})}</div>
</>}
 {settingsTab==='Alertas e aplicativo'&&<div className="panel"><h3>Preferências do aplicativo</h3>{desktop?<><label className="toggle"><input type="checkbox" checked={autoStart} onChange={e=>{const value=e.target.checked;act(async()=>{await invoke('set_autostart',{enabled:value});setAutoStart(value)})}}/>Iniciar com o Windows</label><div className="quick-actions"><button onClick={()=>act(()=>invoke('notify',{message:'Teste de notificação do Pitacco.'}))}>Testar notificação e som</button></div><p>Ao fechar a janela, o Pitacco permanece na bandeja do Windows.</p></>:soundControl}</div>}
 </>}
 {paymentOrder&&<div className="payment-modal-backdrop" role="presentation"><section className="panel payment-modal" role="dialog" aria-modal="true" aria-label="Registrar recebimento"><h3>Registrar recebimento</h3><p>Pedido #{visibleOrderNo(paymentOrder)} · {currency(paymentOrder.gross)}</p><p className="hint">Registre somente dinheiro ou pagamento que você já conferiu. Selecionar Pix ou cartão aqui não realiza cobrança nem consulta a operadora.</p><form onSubmit={registerPayment}><label className="field">Valor recebido<input type="number" min="0.01" step="0.01" required value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)}/></label><label className="field">Forma de pagamento<select value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)}><option value="dinheiro">Dinheiro recebido</option><option value="pix">Pix confirmado manualmente</option><option value="cartao_debito">Débito confirmado</option><option value="cartao_credito">Crédito confirmado</option><option value="outro">Outro recebimento confirmado</option></select></label><label className="field">Referência / observação<input maxLength={120} value={paymentReference} onChange={e=>setPaymentReference(e.target.value)} placeholder="Opcional"/></label><div className="quick-actions"><button disabled={busy}>Confirmar recebimento</button><button className="secondary" type="button" onClick={()=>setPaymentOrder(null)}>Cancelar</button></div></form></section></div>}
 {detail&&<DeliveryDialog key={detail.id} client={client} storeId={storeId} order={detail} dispatchOnly={dispatchOnly} onClose={()=>setDetail(null)}/>}
 </section></>
}
