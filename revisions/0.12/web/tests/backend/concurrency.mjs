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
