import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
let db;
if(process.env.DATABASE_URL){const {Client}=await import('pg');const pg=new Client({connectionString:process.env.DATABASE_URL});await pg.connect();db={exec:s=>pg.query(s),close:()=>pg.end()};}else db=new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,phone text,phone_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,banned_until timestamptz);
create function auth.uid() returns uuid language sql stable as $authuid$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $authuid$;
-- Supabase defines auth.jwt() in production. Stub only in isolated migration tests.
create function auth.jwt() returns jsonb language sql stable as $authjwt$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $authjwt$;
grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
create publication supabase_realtime;
-- TEST ONLY: isolated databases have no Supabase Vault extension.
-- Never include this fixture in the production schema or use real credentials.
create schema vault;
create table vault.secrets(id uuid primary key default gen_random_uuid(), name text, secret text not null, description text);
create view vault.decrypted_secrets as select id,name,secret as decrypted_secret,description from vault.secrets;
create function vault.create_secret(new_secret text,new_name text default null,new_description text default '') returns uuid language plpgsql as $testvault$ declare v uuid; begin insert into vault.secrets(name,secret,description) values(new_name,new_secret,new_description) returning id into v;return v;end $testvault$;
create function vault.update_secret(secret_id uuid,new_secret text default null,new_name text default null,new_description text default null) returns void language sql as $testvault$ update vault.secrets set secret=coalesce(new_secret,secret),name=coalesce(new_name,name),description=coalesce(new_description,description) where id=secret_id $testvault$;
revoke all on schema vault from public,anon,authenticated,service_role;
`);
const web=fileURLToPath(new URL('../../supabase/',import.meta.url));
const mobile=process.env.DG_ANDROID_SUPABASE || fileURLToPath(new URL('../../../android/supabase/',import.meta.url));
for(const file of [web+'schema.sql',web+'003_delivery.sql',mobile+'004_dispatch_mobile.sql',mobile+'005_routes_and_delivery_codes.sql',web+'006_dispatch_batches.sql',web+'007_marketplace_logistics.sql',web+'008_imports_external_delivery.sql',web+'009_menu_images_dispatch_policy.sql',web+'010_acceptance_printing.sql',web+'011_public_checkout.sql',web+'012_order_board.sql']){
 const sql=(await fs.readFile(file,'utf8')).replace('create extension if not exists pgcrypto;','');
 try{await db.exec(sql);console.log('PASS migration',file);}catch(e){console.error('FAIL migration',file,e.message,e.detail,e.where);process.exit(1);}
}
try{await db.exec(await fs.readFile(web+'tests/010_acceptance_printing.test.sql','utf8'));console.log('PASS SQL integration assertions');}catch(e){console.error('FAIL SQL assertions',e.message,e.detail,e.where);process.exit(1);}
try{await db.exec(await fs.readFile(web+'tests/011_public_checkout.test.sql','utf8'));console.log('PASS checkout SQL assertions');}catch(e){console.error('FAIL checkout',e.message,e.detail,e.where);process.exit(1);}
try{await db.exec(await fs.readFile(web+'tests/012_order_board.test.sql','utf8'));console.log('PASS order board SQL assertions');}catch(e){console.error('FAIL board',e.message,e.detail,e.where);process.exit(1);}
await db.exec(await fs.readFile(web+'013_logistics_routes.sql','utf8'));
console.log('PASS migration 013');
try{await db.exec(await fs.readFile(web+'tests/013_logistics_routes.test.sql','utf8'));console.log('PASS logistics SQL assertions');}catch(e){console.error('FAIL logistics',e.message,e.detail,e.where);process.exit(1);}
for(const file of ['011_public_checkout.test.sql','012_order_board.test.sql']){await db.exec(await fs.readFile(web+'tests/'+file,'utf8'));console.log('PASS post-logistics regression',file);}
const fixtureDirectory=new URL('./',import.meta.url);
await db.exec(await fs.readFile(web+'016_fideliza.sql','utf8'));
// No PostgreSQL 17, testes usam pgcrypto real. No PGlite, a extensão não
// existe; somente o harness isolado fornece emulação funcional.
const liteCryptoShim=String.raw`
create function extensions.hmac(document text, key text, algorithm text) returns bytea
 language sql immutable as $lite$ select convert_to(md5(document||key||algorithm),'UTF8') $lite$;
create function extensions.gen_salt(kind text, rounds integer) returns text
 language sql volatile as $lite$ select '$2a$11$'||substr(replace(gen_random_uuid()::text,'-',''),1,22) $lite$;
create function extensions.crypt(secret text, salt text) returns text
 language sql immutable as $lite$ select '$2a$11$'||substr(salt,8,22)||md5(secret||substr(salt,8,22)) $lite$;
`;
for (const file of ['fixture-schema.sql','production-function-fixture.sql']) {
 let sql=await fs.readFile(new URL(file,fixtureDirectory),'utf8');
 if(!process.env.DATABASE_URL&&file==='fixture-schema.sql')
  sql=sql.replace('create extension if not exists pgcrypto with schema extensions;',()=>liteCryptoShim);
 await db.exec(sql);
}
const migrationsDirectory=new URL('../../../supabase/migrations/',import.meta.url);
for (const file of (await fs.readdir(migrationsDirectory)).filter(name=>name.endsWith('.sql')).sort()) {
 let sql=await fs.readFile(new URL(file,migrationsDirectory),'utf8');
 if(!process.env.DATABASE_URL)
  sql=sql.replace('create extension if not exists pgcrypto with schema extensions;','-- PGlite: emulador usado somente em fixtures de teste');
 await db.exec(sql);
 console.log('PASS production compatibility migration',file);
}
for (const file of ['checkout-variants.test.sql','fideliza-runtime.test.sql','fiado-credit.test.sql','store-trial.test.sql','inventory.test.sql','inventory-options.test.sql','cancelled-beverage-returns.test.sql','order-decisions.test.sql','active-order-cancellation.test.sql','incident-whatsapp.test.sql','financial-report.test.sql','scheduled-orders.test.sql','operational-alerts.test.sql','subscription-entitlement.test.sql','asaas-subscription.test.sql','delivery-tracking.test.sql','marketplace-settlements.test.sql','admin-homologation.test.sql','platform-owner.test.sql','storefront-settings.test.sql','delivery-pricing.test.sql','support-center.test.sql','incident-monitor.test.sql','storefront-design.test.sql','menu-category-icons.test.sql','store-opening-hours.test.sql','onboarding-preflight.test.sql','windows-presence.test.sql','windows-paper-confirmation.test.sql','ifood-events.test.sql','ifood-arrival-dispatch-gate.test.sql','owner-platform-dashboard.test.sql','commercial-plans.test.sql','flex-fixo-cutover.test.sql','asaas-recovery.test.sql','app-releases.test.sql','courier-push.test.sql']) {
 try {
  await db.exec(await fs.readFile(new URL(file,fixtureDirectory),'utf8'));
 } catch (error) {
  console.error('FAIL SQL regression',file,error.message,error.detail,error.where);
  process.exit(1);
 }
 console.log('PASS SQL regression',file);
}
await db.close();
