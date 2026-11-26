// Single attempt shared across mounts; web never calls the Windows bridge.
let startupAttempt;
export function runWindowsStartupUpdate(native,call){
 if(!native)return Promise.resolve({state:'skipped'});
 if(!startupAttempt)startupAttempt=Promise.resolve().then(()=>call('startup_update')).then(message=>({state:'done',message}),()=>({state:'deferred'}));
 return startupAttempt;
}
export const UPDATE_POLL_MS=30*60*1000;
export function startWindowsUpdatePolling({native,call,onAvailable,schedule=setInterval,cancel=clearInterval}){
 if(!native)return ()=>{};
 let live=true,busy=false;
 async function check(){
  if(!live||busy)return;
  busy=true;
  try{const version=await call('check_update_available');if(live&&typeof version==='string'&&version)onAvailable(version)}
  catch{/* A missing network or update feed must not interrupt operations. */}
  finally{busy=false}
 }
 const id=schedule(check,UPDATE_POLL_MS);
 return ()=>{live=false;cancel(id)};
}
