import {Client} from 'pg';import assert from 'node:assert/strict';
const admin=new Client({connectionString:process.env.DATABASE_URL});await admin.connect();
// Realistic isolated checkout fixtures need a valid Flex contract under the mandatory-plan gate.
async function activateFixturePlan(client,storeId){
 const result=await client.query(`insert into pitacco_private.commercial_contracts(store_id,revision,plan_code,effective_from,terms)
 select $1,v.revision,'free',(now() at time zone 'America/Sao_Paulo')::date,x from public.pitacco_plan_catalog_signal s
 join pitacco_private.plan_catalog_versions v on v.revision=s.revision cross join lateral jsonb_array_elements(v.plans) x
 where s.singleton and x->>'code'='free'`,[storeId]);
 assert.equal(result.rowCount,1);
}
const manager='10000000-0000-0000-0000-000000000001',courier='30000000-0000-0000-0000-000000000001';
await admin.query(`insert into auth.users(id,email) values('${manager}','manager@example.invalid'),('10000000-0000-0000-0000-000000000002','courier@example.invalid');insert into public.stores(id,name,max_orders_per_trip) values('20000000-0000-0000-0000-000000000001','Concurrency',1);insert into public.store_members values('20000000-0000-0000-0000-000000000001','${manager}','gestor');insert into public.couriers(id,user_id,name,fleet_type,store_id) values('${courier}','10000000-0000-0000-0000-000000000002','Courier','propria','20000000-0000-0000-0000-000000000001');insert into public.deliveries(id,store_id,customer_name,address) values('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','A','Example'),('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','B','Example');`);
const clients=await Promise.all([0,1].map(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();await c.query(`set role authenticated;select set_config('request.jwt.claim.sub','${manager}',false)`);return c}));
try{
 // Without explicit confirmation, one concurrent assignment may open a route;
 // the second must not silently override the automatic target or existing route.
 const results=await Promise.allSettled(clients.map((c,i)=>c.query('select public.assign_order_courier($1,$2,false)',[`40000000-0000-0000-0000-00000000000${i+1}`,courier])));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'Unconfirmed concurrent assignment must not join an existing route');
 assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const initial=await admin.query('select id,batch_id from public.deliveries where courier_id=$1',[courier]);assert.equal(initial.rowCount,1);
 const other=await admin.query('select id from public.deliveries where courier_id is null and store_id=$1',['20000000-0000-0000-0000-000000000001']);assert.equal(other.rowCount,1);
 const confirmed=await Promise.all(clients.map(c=>c.query('select public.assign_order_courier($1,$2,true)',[other.rows[0].id,courier])));
 assert.ok(confirmed.every(r=>r.rows[0].assign_order_courier===initial.rows[0].batch_id),'Both retries resolve the existing route');
 const rows=await admin.query('select id,batch_id from public.deliveries where courier_id=$1',[courier]);assert.equal(rows.rowCount,2);assert.equal(new Set(rows.rows.map(r=>r.batch_id)).size,1);
 await Promise.all(clients.map(c=>c.query('select public.assign_order_courier($1,$2,true)',[initial.rows[0].id,courier])));
 assert.equal((await admin.query("select count(*)::int n from public.operation_audit where action='route_manual_assigned'")).rows[0].n,2,'Concurrent retries do not duplicate audit or assignment');
 console.log('PASS PostgreSQL simultaneous manual confirmation, explicit capacity override and idempotent assignment');
}finally{await Promise.all(clients.map(c=>c.end()));await admin.end()}

// A mesma carteira não pode gastar os mesmos pontos em dois checkouts simultâneos.
const loyaltyAdmin=new Client({connectionString:process.env.DATABASE_URL});await loyaltyAdmin.connect();
const loyaltyClients=await Promise.all([0,1].map(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();return c}));
try{
 const s='20000000-0000-0000-0000-000000000093',p='30000000-0000-0000-0000-000000000093';
 await loyaltyAdmin.query(`insert into public.stores(id,name) values($1,'Fideliza concorrente');`,[s]);
 await activateFixturePlan(loyaltyAdmin,s);
 await loyaltyAdmin.query(`insert into public.public_menu_settings(store_id,slug,enabled,pickup_enabled,delivery_enabled,delivery_fee,payment_methods) values($1,'loyalty-race',true,true,true,0,array['pix_manual']) on conflict(store_id) do update set slug=excluded.slug,enabled=true,pickup_enabled=true,payment_methods=excluded.payment_methods`,[s]);
 await loyaltyAdmin.query(`insert into public.products(id,store_id,name,price,cost,menu_active) values($1,$2,'Produto',100,0,true)`,[p,s]);
 await loyaltyAdmin.query(`insert into public.loyalty_programs(store_id,points_enabled,points_per_real,min_points_to_redeem,points_reward_cents) values($1,true,1,100,1000)`,[s]);
 // A primeira compra cria a carteira pelo telefone, sem chamar cadastro por chave.
 const items=JSON.stringify([{product_id:p,quantity:1,options:[]}]);
 const buySql=`select public.pitacco_loyalty_checkout('loyalty-race',$1,'Cliente','21999990093','',$2::jsonb,'pickup','pix_manual','',$3,'',$4) as result`;
 const first=(await loyaltyAdmin.query(buySql,['60000000-0000-0000-0000-000000000093',items,'',''])).rows[0].result;
 await loyaltyAdmin.query(`update public.orders set status='accepted',preparation_status='completed',receipt=receipt||'{"payment_status":"paid"}' where id=$1`,[first.order_id]);
 const requests=['60000000-0000-0000-0000-000000000094','60000000-0000-0000-0000-000000000095'];
 const outcomes=await Promise.allSettled(loyaltyClients.map((c,i)=>c.query(buySql,[requests[i],items,'','points'])));
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1,'Only one concurrent redemption spends the balance');
 assert.equal(outcomes.filter(r=>r.status==='rejected').length,1);
 const winner=outcomes.findIndex(r=>r.status==='fulfilled');
 const replay=await Promise.all(loyaltyClients.map(c=>c.query(buySql,[requests[winner],items,'','points'])));
 assert.equal(replay[0].rows[0].result.order_id,replay[1].rows[0].result.order_id);
 const total=await loyaltyAdmin.query(`select count(*)::int as n from public.loyalty_ledger where store_id=$1 and event_type='redeem'`,[s]);
 assert.equal(total.rows[0].n,1,'Simultaneous retries do not duplicate the debit');
 console.log('PASS PostgreSQL Fideliza concurrent redemption and idempotent retry');
}finally{await Promise.all(loyaltyClients.map(c=>c.end()));await loyaltyAdmin.end()}

// Two tabs retrying the same lost confirmation must produce exactly one sale.
const checkoutAdmin=new Client({connectionString:process.env.DATABASE_URL});await checkoutAdmin.connect();
const checkoutClients=await Promise.all([0,1].map(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();await c.query('set role anon');return c}));
try{
 const s='93000000-0000-0000-0000-000000000001',p='93000000-0000-0000-0000-000000000002',r='93000000-0000-0000-0000-000000000003';
 await checkoutAdmin.query(`insert into public.stores(id,name,dispatch_mode) values($1,'Checkout race fixture','manual')`,[s]);
 await activateFixturePlan(checkoutAdmin,s);
 await checkoutAdmin.query(`insert into public.public_menu_settings(store_id,slug,enabled,pickup_enabled,delivery_enabled,payment_methods,pix_instructions) values($1,'checkout-race-fixture',true,true,false,array['pix_manual'],'Fixture Pix') on conflict(store_id) do update set slug=excluded.slug,enabled=true,pickup_enabled=true,delivery_enabled=false,payment_methods=excluded.payment_methods,pix_instructions=excluded.pix_instructions`,[s]);
 await checkoutAdmin.query(`insert into public.products(id,store_id,name,price,cost,menu_active) values($1,$2,'Fixture',25,8,true)`,[p,s]);
 const items=JSON.stringify([{product_id:p,quantity:2,options:[]}]);
 const sql=`select public.checkout_public_order('checkout-race-fixture',$1,'Cliente','21999990001','',$2::jsonb,'pickup','pix_manual','Preservar observação') as result`;
 const receipts=await Promise.all(checkoutClients.map(c=>c.query(sql,[r,items])));
 assert.deepEqual(receipts[0].rows[0].result,receipts[1].rows[0].result,'Concurrent replays return the same order and tracking token');
 assert.equal((await checkoutAdmin.query('select count(*)::int n from public.orders where store_id=$1 and request_id=$2',[s,r])).rows[0].n,1);
 assert.equal((await checkoutAdmin.query('select count(*)::int n from public.public_checkouts where store_id=$1 and request_id=$2',[s,r])).rows[0].n,1);
 await assert.rejects(()=>checkoutClients[0].query(sql,[r,JSON.stringify([{product_id:p,quantity:1,options:[]}])]),/Chave reutilizada com dados diferentes/);
 console.log('PASS PostgreSQL simultaneous public checkout retry, one sale, one tracking token and immutable payload');
}finally{await Promise.all(checkoutClients.map(c=>c.end()));await checkoutAdmin.end()}
