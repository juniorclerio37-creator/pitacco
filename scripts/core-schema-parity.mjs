// Diagnostic only: compare isolated test schema to recorded production metadata.
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const url = new URL(process.env.DATABASE_URL ?? '');
if (!['localhost','127.0.0.1'].includes(url.hostname) || url.pathname !== '/postgres' || process.env.PITACCO_CORE_ISOLATED !== '1') {
  throw new Error('Schema parity is restricted to explicitly isolated local CI.');
}
const require = createRequire(resolve('web/tests/backend/package.json'));
const {Client} = require('pg');
const client = new Client({connectionString:url.toString()});
await client.connect();
const specs = {
  relations: {
    key:r=>[r.schema,r.name,r.kind].join('|'),
    query:"select n.nspname as schema,c.relname as name,c.relkind as kind,c.relrowsecurity as rls,c.relforcerowsecurity as force_rls,(select count(*) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as columns,(select count(*) from pg_constraint x where x.conrelid=c.oid) as constraints,(select count(*) from pg_index x where x.indrelid=c.oid) as indexes from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','pitacco_private') and c.relkind in ('r','p','v','m','S')",
    fields:['rls','force_rls','columns','constraints','indexes']
  },
  routines: {
    key:r=>[r.schema,r.name,r.arguments].join('|'),
    query:"select n.nspname as schema,p.proname as name,pg_get_function_identity_arguments(p.oid) as arguments,p.prokind as kind,p.prosecdef as security_definer,case when p.prokind in ('f','p','w') then pg_get_functiondef(p.oid) end as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','pitacco_private')",
    fields:['kind','security_definer','definition_sha256'],
  },
  policies: {
    key:r=>[r.schema,r.table_name,r.policy].join('|'),
    query:"select schemaname as schema,tablename as table_name,policyname as policy,permissive,roles,cmd,coalesce(qual,'')||chr(10)||coalesce(with_check,'') as expression from pg_policies where schemaname in ('public','pitacco_private')",
    fields:['permissive','roles','cmd','expression_sha256']
  },
  triggers: {
    key:r=>[r.schema,r.table_name,r.trigger].join('|'),
    query:"select n.nspname as schema,c.relname as table_name,t.tgname as trigger,t.tgenabled as enabled,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','pitacco_private')",
    fields:['enabled','definition_sha256']
  }
};
const {createHash}=await import('node:crypto');
const hash=s=>s==null?null:createHash('sha256').update(s,'utf8').digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const normalize=(field,value)=>['columns','constraints','indexes'].includes(field)?Number(value):field==='roles'?(Array.isArray(value)?value:typeof value==='string'?value.replace(/^\{|\}$/g,'').split(','):[]).slice().sort():value;
const report={warning:'Fixture database comparison, not proof of production parity. Test fixtures and PostgreSQL formatting can differ. No production access.',objects:{}};
try {
  for(const [kind,spec] of Object.entries(specs)){
    const prod=JSON.parse(await fs.readFile('docs/core/schema-baseline/'+kind+'.json','utf8'));
    const {rows}=await client.query(spec.query);
    for(const r of rows){
      if('definition' in r){r.definition_sha256=hash(r.definition);delete r.definition;}
      if('expression' in r){r.expression_sha256=hash(r.expression);delete r.expression;}
    }
    const map=new Map(rows.map(r=>[spec.key(r),r])), known=new Set(prod.map(spec.key));
    const missing=[],changed=[],extra=[];
    for(const r of prod){
      const k=spec.key(r), current=map.get(k);
      if(!current){missing.push(k);continue;}
      const fields=spec.fields.filter(f=>!equal(normalize(f,r[f]),normalize(f,current[f])));
      if(fields.length)changed.push({key:k,fields});
    }
    for(const r of rows)if(!known.has(spec.key(r)))extra.push(spec.key(r));
    report.objects[kind]={production:prod.length,isolated:rows.length,missing,changed,extra,matching:prod.length-missing.length-changed.length};
  }
} finally {await client.end();}
await fs.writeFile('core-schema-parity.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(report.objects).map(([k,v])=>[k,{production:v.production,isolated:v.isolated,matching:v.matching,missing:v.missing.length,changed:v.changed.length,extra:v.extra.length}])),null,2));
