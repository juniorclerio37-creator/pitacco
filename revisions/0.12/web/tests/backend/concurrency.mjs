import {Client} from 'pg';import assert from 'node:assert/strict';
const admin=new Client({connectionString:process.env.DATABASE_URL});await admin.connect();
const manager='10000000-0000-0000-0000-000000000001',courier='30000000-0000-0000-0000-000000000001';
await admin.query(`insert into auth.users(id,email) values('${manager}','manager@example.invalid'),('10000000-0000-0000-0000-000000000002','courier@example.invalid');insert into public.stores(id,name,max_orders_per_trip) values('20000000-0000-0000-0000-000000000001','Concurrency',1);insert into public.store_members values('20000000-0000-0000-0000-000000000001','${manager}','gestor');insert into public.couriers(id,user_id,name,fleet_type,store_id) values('${courier}','10000000-0000-0000-0000-000000000002','Courier','propria','20000000-0000-0000-0000-000000000001');insert into public.deliveries(id,store_id,customer_name,address) values('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','A','Example'),('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','B','Example');`);
const clients=await Promise.all([0,1].map(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();await c.query(`set role authenticated;select set_config('request.jwt.claim.sub','${manager}',false)`);return c}));
try{
 const results=await Promise.allSettled(clients.map((c,i)=>c.query('select public.assign_order_courier($1,$2,true)',[`40000000-0000-0000-0000-00000000000${i+1}`,courier])));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'Only one concurrent assignment fits capacity');
 assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const rows=await admin.query('select id,batch_id from public.deliveries where courier_id=$1',[courier]);assert.equal(rows.rowCount,1);
 await Promise.all(clients.map(c=>c.query('select public.assign_order_courier($1,$2,true)',[rows.rows[0].id,courier])));
 assert.equal((await admin.query("select count(*)::int n from public.operation_audit where action='route_manual_assigned'")).rows[0].n,1,'Concurrent retries do not duplicate audit or assignment');
 console.log('PASS PostgreSQL simultaneous capacity race and idempotent double assignment');
}finally{await Promise.all(clients.map(c=>c.end()));await admin.end()}

// A mesma carteira não pode gastar os mesmos pontos em dois checkouts simultâneos.
const loyaltyAdmin=new Client({connectionString:process.env.DATABASE_URL});await loyaltyAdmin.connect();
const loyaltyClients=await Promise.all([0,1].map(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();return c}));
try{
 const s='20000000-0000-0000-0000-000000000093',p='30000000-0000-0000-0000-000000000093';
 await loyaltyAdmin.query(`insert into public.stores(id,name) values($1,'Fideliza concorrente');`,[s]);
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
