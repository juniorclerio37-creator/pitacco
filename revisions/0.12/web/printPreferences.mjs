const keyFor=storeId=>'pitacco:print-options:'+storeId;

export function readPrintPreferences(storeId){
 try{
  const value=JSON.parse(localStorage.getItem(keyFor(storeId))||'{}');
  return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 }catch{
  return {};
 }
}

export function savePrintPreference(storeId,field,value){
 try{
  localStorage.setItem(keyFor(storeId),JSON.stringify({...readPrintPreferences(storeId),[field]:value}));
  return true;
 }catch{
  return false;
 }
}
