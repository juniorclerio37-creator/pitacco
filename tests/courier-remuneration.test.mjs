import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('Cadastro do motoboy salva a remuneracao junto do telefone, sem chave privada na UI',()=>{
 const manager=read('revisions/0.12/web/CourierAccessManager.jsx');
 const fields=read('revisions/0.12/web/CourierRemunerationFields.jsx');
 const css=read('revisions/0.12/web/CourierAccessManager.css');
 const api=read('supabase/functions/pitacco-courier-access/index.ts');
 assert.match(manager,/phone:submittedPhone,remuneration/);
 assert.match(manager,/<CourierRemunerationFields value={remuneration}/);
 assert.match(manager,/set-remuneration/);
 assert.match(manager,/remunerationLabel\(c.remuneration\)/);
 assert.match(fields,/value:'customer_fee'/);
 assert.match(fields,/value:'per_delivery'/);
 assert.match(fields,/value:'per_km'/);
 assert.match(fields,/value:'daily'/);
 assert.match(fields,/value:'mixed'/);
 assert.match(fields,/frete grátis promocional/);
 assert.match(css,/pitacco-driver-registration-pay/);
 assert.match(api,/function validRemuneration\(value: unknown\)/);
 assert.match(api,/if\(!remuneration\)return \[400/);
 assert.match(api,/\.insert\(\{store_id:storeId,courier_id:courier.id,\.\.\.remuneration\}\)/);
 assert.match(api,/admin\.auth\.admin\.deleteUser\(userId\)/);
 assert.match(api,/if\(action==="set-remuneration"\)/);
 assert.match(api,/await authorizeStore\(actor,storeId\)/);
 assert.doesNotMatch(manager,/SUPABASE_SERVICE_ROLE_KEY/);
});

test('Cliente recebe frete gratis promocional mas motoboy ganha a taxa ORIGINAL',()=>{
 const m=read('supabase/migrations/20261118201000_courier_original_freight_and_workday.sql');
 const quoted=read('supabase/migrations/20261118201100_checkout_original_freight_receipt.sql');
 const ifood=read('supabase/functions/ifood-orders/handler.mjs');
 assert.match(m,/original_delivery_fee/);
 assert.match(m,/old.original_delivery_fee is not null/);
 assert.match(m,/new.original_delivery_fee:=old.original_delivery_fee/);
 assert.match(m,/if v_rule.mode='customer_fee' or v_rule.include_customer_fee/);
 assert.match(m,/v_amount:=v_amount\+v_original/);
 assert.match(m,/new.courier_payment:=0/);
 assert.match(m,/if v_original is null then return new/);
 assert.match(quoted,/delivery_fee_original/);
 assert.match(quoted,/checkout_public_order_coupon/);
 assert.match(ifood,/target==='DELIVERY_FEE'/);
 assert.match(ifood,/delivery_fee_original:originalDeliveryFee/);
 assert.match(ifood,/delivery_fee_customer:Math.max/);
});

test('Diarias nao se multiplicam pelo numero de entregas e entram no balanco dos dois paineis',()=>{
 const m=read('supabase/migrations/20261118201000_courier_original_freight_and_workday.sql');
 const totals=read('supabase/migrations/20261118201200_courier_daily_financial_reports.sql');
 const driver=read('entregador/painel.html');
 const finance=read('revisions/0.12/web/CourierFinance.jsx');
 const manager=read('revisions/0.12/web/CourierWorkspace.jsx');
 assert.match(m,/on conflict \(store_id,courier_id,work_date\) do nothing/);
 assert.match(m,/new.status='entregue' and old.status<>'entregue'/);
 assert.match(m,/old.status='entregue'/);
 assert.match(totals,/allowances as materialized/);
 assert.match(totals,/daily_allowance/);
 assert.match(totals,/coalesce\(d.earned,0\)\+coalesce\(a.allowance,0\)/);
 assert.match(totals,/pitacco_courier_daily_allowances/);
 assert.match(driver,/earnDailyAllowance/);
 assert.match(finance,/deliveryEarned\+dailyEarned/);
 assert.match(manager,/todayAllowances/);
 assert.match(finance,/\.eq\('status','entregue'\)/);
});
