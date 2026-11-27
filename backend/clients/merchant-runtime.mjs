// One authenticated merchant runtime for browser and native Windows host.
import {createMerchantBoard} from './merchant-board.mjs';
import {createMerchantMap} from './merchant-map.mjs';
import {createWindowsPrintClient} from './windows-print.mjs';
import {createWindowsDevice} from './windows-device.mjs';
import {ingestJobs} from '../../core-source/web/printBridge.mjs';

export function createMerchantRuntime({session,windows=null}){
 const selected=session.snapshot().selected;
 if(!selected||selected.role==='courier')throw Error('Loja não autorizada.');
 const store=selected.store_id,scopedFetch=session.scopedFetch();
 const map=createMerchantMap({store,scopedFetch}),board=createMerchantBoard({store,scopedFetch});
 let print=null,device=null,active=true;
 function stop(){if(!active)return;active=false;map.stop();board.stop();if(device)device.stop();else print?.stop();}
 try{
  if(windows!==null){
   const {deviceId,nativeCall,onState,storeLogoPath,client,schedule,cancel}=windows;
   // Only native host explicitly supplies bridge, device and original renderer.
   print=createWindowsPrintClient({store,device:deviceId,scopedFetch,nativeCall,
    ingestJobs,storeName:selected.name,storeLogoPath,client,unified:true});
   device=createWindowsDevice({store,device:deviceId,scopedFetch,printClient:print,onState,schedule,cancel});
  }
  const detach=session.attach({stop});
  return {store,map,board,device,stop:detach};
 }catch(e){stop();throw e;}
}
