import {orderStage} from './orderBoard.mjs';

// Keep the initial snapshot quiet, then announce newly eligible orders exactly once per feed.
export function newOrderTracker(storeId){
 const announced=new Set();
 let initialized=false;
 return function observe(orders){
  const eligible=orders.filter(order=>{
   if(order.store_id!==storeId||!order.id)return false;
   const stage=orderStage(order);
   return stage==='analysis'||stage==='preparing'||stage==='ready';
  });
  const fresh=initialized?eligible.filter(order=>!announced.has(order.id)):[];
  eligible.forEach(order=>announced.add(order.id));
  initialized=true;
  return fresh;
 };
}

export function windowsStore(storage,userId,stores,current=''){
 const saved=readWindowsStore(storage,userId);
 if(stores.some(store=>store.id===current))return current;
 if(stores.some(store=>store.id===saved))return saved;
 return stores.length===1?stores[0].id:'';
}
function readWindowsStore(storage,userId){
 try{return storage?.getItem('pitacco.windows.store.'+userId)||'';}catch{return '';}
}
export function saveWindowsStore(storage,userId,storeId){
 try{if(userId&&storeId)storage?.setItem('pitacco.windows.store.'+userId,storeId);}catch{}
}
