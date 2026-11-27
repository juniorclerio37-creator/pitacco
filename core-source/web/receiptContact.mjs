// Contact for a printed order: reject objects and expired phone-localizer pairs.
const scalar=value=>typeof value==='string'||typeof value==='number'?String(value).trim():'';
const first=(...values)=>values.map(scalar).find(Boolean)||'';
export function receiptContact(r,now=Date.now()){
 const nested=r.customer?.phone;
 const expiry=first(r.phone_localizer_expiration,r.contact_expires_at,nested?.localizerExpiration,r.phone?.localizerExpiration);
 if(expiry&&(!Number.isFinite(Date.parse(expiry))||Date.parse(expiry)<=now))return {phone:'',locator:''};
 const raw=first(r.phone?.number,r.phone,r.customer_phone,nested?.number,nested,r.buyer?.phone,r.delivery?.customer_phone);
 const phone=raw.split(',')[0].trim();
 const locator=first(r.localizer,r.localizador,r.locator,r.order_locator,r.delivery_locator,r.external_locator,r.pickup_locator,r.phone_localizer,nested?.localizer,r.phone?.localizer,raw.split(',')[1]);
 return {phone,locator};
}
