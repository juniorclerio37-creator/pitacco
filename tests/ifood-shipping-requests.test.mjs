import test from 'node:test';
import assert from 'node:assert/strict';
import {buildShippingRequest} from '../supabase/functions/ifood-shipping/requests.mjs';
const uid="11111111-1111-4111-8111-111111111111",merchant="22222222-2222-4222-8222-222222222222",order="33333333-3333-4333-8333-333333333333",now=1795615200000,quote={"id":"11111111-1111-4111-8111-111111111111","expirationAt":"2026-11-25T15:00:00Z","orderId":"33333333-3333-4333-8333-333333333333","merchantId":"22222222-2222-4222-8222-222222222222","latitude":-22.75,"longitude":-43.45};
function rejects(fn){try{fn();return false}catch{return true}}
test("inside quote",()=>assert.equal((()=>buildShippingRequest("inside_quote",{orderId:order}).path.endsWith("/deliveryAvailabilities"))(),true));
test("outside quote",()=>assert.equal((()=>buildShippingRequest("outside_quote",{merchantId:merchant,latitude:-22.75,longitude:-43.45}).path.includes("latitude=-22.75"))(),true));
test("request driver quote",()=>assert.equal((()=>buildShippingRequest("request_driver",{orderId:order,quote,now}).body.quoteId===uid)(),true));
test("cross-order quote rejected",()=>assert.equal((()=>rejects(()=>buildShippingRequest("request_driver",{orderId:uid,quote,now})))(),true));
test("expired quote rejected",()=>assert.equal((()=>rejects(()=>buildShippingRequest("request_driver",{orderId:order,quote,now:now+7200000})))(),true));
test("dynamic cancellation",()=>assert.equal((()=>buildShippingRequest("cancel",{orderId:order,reasonCode:"817",reasons:[{cancelCodeId:"817",description:"Teste"}]}).body.cancellationCode===817)(),true));
test("unknown reason rejected",()=>assert.equal((()=>rejects(()=>buildShippingRequest("cancel",{orderId:order,reasonCode:"818",reasons:[{cancelCodeId:"817",description:"Teste"}]})))(),true));
test("address accepted",()=>assert.equal((()=>buildShippingRequest("accept_address",{orderId:order,pendingAddress:{orderId:order,createdAt:"2026-11-25T13:55:00Z"},now}).path.endsWith("acceptDeliveryAddressChange"))(),true));
test("address rejected",()=>assert.equal((()=>buildShippingRequest("deny_address",{orderId:order,pendingAddress:{orderId:order,createdAt:"2026-11-25T13:55:00Z"},now}).path.endsWith("denyDeliveryAddressChange"))(),true));
test("late address blocked",()=>assert.equal((()=>rejects(()=>buildShippingRequest("accept_address",{orderId:order,pendingAddress:{orderId:order,createdAt:"2026-11-25T13:40:00Z"},now})))(),true));
test("unknown action rejected",()=>assert.equal((()=>rejects(()=>buildShippingRequest("other",{})))(),true));
