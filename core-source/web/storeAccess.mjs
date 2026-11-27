import {useEffect,useState} from 'react';

export function useStoreManagerAccess(client,userId,storeId) {
 const [attempt,setAttempt]=useState(0);
 const [result,setResult]=useState(null);

 useEffect(()=>{
  if(!client||!userId||!storeId)return;
  let current=true;
  async function check() {
   try {
    const {data,error}=await client.rpc('is_store_manager',{s:storeId});
    if(error||typeof data!=='boolean')throw new Error('Resposta de autorização indisponível');
    if(current)setResult({userId,storeId,attempt,status:'ready',manager:data});
   } catch {
    if(current)setResult({userId,storeId,attempt,status:'error',manager:false});
   }
  }
  void check();
  return()=>{current=false;};
 },[client,userId,storeId,attempt]);

 if(!client||!userId||!storeId)return {status:'ready',manager:false};
 const access=result?.userId===userId&&result.storeId===storeId&&result.attempt===attempt
  ? result : {status:'loading',manager:false};
 return {...access,retry:()=>setAttempt(value=>value+1)};
}
