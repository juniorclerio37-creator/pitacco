import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
let db;
if(process.env.DATABASE_URL){const {Client}=await import('pg');const pg=new Client({connectionString:process.env.DATABASE_URL});await pg.connect();db={exec:s=>pg.query(s),close:()=>pg.end()};}else db=new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
create publication supabase_realtime;
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
await db.close();
