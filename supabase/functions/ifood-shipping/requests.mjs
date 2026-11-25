// Shipping API request builder. Inputs must be server-authorized; never expose as an arbitrary proxy.
export function buildShippingRequest(action,input){
 const id=v=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
 const check=(ok,msg)=>{if(!ok)throw Error(msg)};
 const str=(v,max=100)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=max;
 const coord=(lat,lng)=>typeof lat==='number'&&Number.isFinite(lat)&&Math.abs(lat)<=90&&typeof lng==='number'&&Number.isFinite(lng)&&Math.abs(lng)<=180;
 const cash=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100000&&Math.abs(v*100-Math.round(v*100))<0.000001;
 const root='/shipping/v1.0';
 const order=()=>{check(id(input.orderId),'invalid order');return root+'/orders/'+input.orderId};
 const merchant=()=>{check(id(input.merchantId),'invalid merchant');return root+'/merchants/'+input.merchantId};
 const quote=()=>{check(id(input.quote?.id)&&Number.isFinite(input.now)&&Number.isFinite(Date.parse(input.quote.expirationAt))&&Date.parse(input.quote.expirationAt)>input.now,'quote invalid or expired');return input.quote.id};
 const post=(path,body)=>({path,method:'POST',...(body===undefined?{}:{body})});
 switch(action){
 case 'inside_quote':return {method:'GET',path:order()+'/deliveryAvailabilities'};
 case 'outside_quote':check(coord(input.latitude,input.longitude),'invalid coordinates');return {method:'GET',path:merchant()+'/deliveryAvailabilities?latitude='+input.latitude+'&longitude='+input.longitude};
 case 'request_driver':check(input.quote?.orderId===input.orderId,'quote order mismatch');return post(order()+'/requestDriver',{quoteId:quote()});
 case 'create_order':{
  const a=input.address,p=input.phone,items=input.items;
  check(input.quote?.merchantId===input.merchantId&&input.quote.latitude===a?.coordinates?.latitude&&input.quote.longitude===a?.coordinates?.longitude,'quote address mismatch');
  check(str(input.customer)&&/^\d{2}$/.test(p?.areaCode??'')&&/^\d{8,9}$/.test(p?.number??''),'invalid customer');
  check(a&&/^\d{8}$/.test(a.postalCode)&&str(a.streetNumber)&&str(a.streetName)&&str(a.neighborhood)&&str(a.city)&&/^[A-Z]{2}$/.test(a.state)&&a.country==='BR'&&coord(a.coordinates?.latitude,a.coordinates?.longitude),'invalid address');
  check(cash(input.merchantFee)&&Number.isInteger(input.preparationTime)&&input.preparationTime>=0&&input.preparationTime<=7200,'invalid delivery fee or preparation time');
  check(Array.isArray(items)&&items.length>0&&items.length<=100,'invalid items');
  const normalized=items.map(i=>{check(id(i.id)&&str(i.name)&&Number.isInteger(i.quantity)&&i.quantity>0&&i.quantity<=100&&cash(i.unitPrice)&&cash(i.optionsPrice),'invalid item');const price=Math.round(i.unitPrice*100)*i.quantity/100;return {id:i.id,name:i.name.trim(),quantity:i.quantity,unitPrice:i.unitPrice,price,optionsPrice:i.optionsPrice,totalPrice:(Math.round(price*100)+Math.round(i.optionsPrice*100))/100}});
  check(input.prepaid===true,'only prepaid test orders');
  return post(merchant()+'/orders',{customer:{name:input.customer.trim(),phone:{countryCode:'55',areaCode:p.areaCode,number:p.number,type:'CUSTOMER'}},delivery:{merchantFee:input.merchantFee,quoteId:quote(),preparationTime:input.preparationTime,deliveryAddress:{postalCode:a.postalCode,streetNumber:a.streetNumber,streetName:a.streetName,neighborhood:a.neighborhood,city:a.city,state:a.state,country:'BR',coordinates:{latitude:a.coordinates.latitude,longitude:a.coordinates.longitude},...(str(a.complement)?{complement:a.complement}:{})}},items:normalized});
 }
 case 'details':check(id(input.orderId),'invalid order');return {method:'GET',path:'/order/v1.0/orders/'+input.orderId};
 case 'reasons':return {method:'GET',path:order()+'/cancellationReasons'};
 case 'cancel':{
  check(Array.isArray(input.reasons)&&typeof input.reasonCode==='string'&&/^\d{1,8}$/.test(input.reasonCode),'invalid cancellation reason');
  const selected=input.reasons.find(r=>String(r.cancelCodeId)===input.reasonCode&&str(r.description,250));
  check(selected,'reason not returned by provider');
  return post(order()+'/cancel',{reason:selected.description,cancellationCode:Number(input.reasonCode)});
 }
 case 'accept_address':case 'deny_address':
  check(input.pendingAddress?.orderId===input.orderId&&Number.isFinite(Date.parse(input.pendingAddress.createdAt))&&input.now>=Date.parse(input.pendingAddress.createdAt)&&input.now-Date.parse(input.pendingAddress.createdAt)<15*60000,'no active address request');
  return post(order()+(action==='accept_address'?'/acceptDeliveryAddressChange':'/denyDeliveryAddressChange'));
 case 'cancel_driver':return post(order()+'/cancelRequestDriver');
 default:throw Error('unsupported action');
 }
}
