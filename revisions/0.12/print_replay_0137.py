"""Preserve immutable locally saved print jobs on cloud redelivery."""
from pathlib import Path
def patch(path,old,new):
 p=Path(path);s=p.read_text(encoding='utf-8')
 assert s.count(old)==1, f'Unexpected print replay anchor: {path}: {old[:80]}'
 p.write_text(s.replace(old,new,1),encoding='utf-8')
# Native lookup checks the complete immutable routing identity, but never returns receipt content.
patch('web/src-tauri/src/queue.rs','pub fn enqueue(db:&Connection,j:&Job)->Result<(),String>{',r'''
pub fn has_saved(db:&Connection,id:&str,store_id:&str,printer:&str,width:u16)->Result<bool,String>{
 if uuid::Uuid::parse_str(id).is_err() || uuid::Uuid::parse_str(store_id).is_err() || ![58,80].contains(&width){return Err("Trabalho inválido".into())}
 let prior:Option<(String,String,u16)>=db.query_row("SELECT store_id,printer,width FROM jobs WHERE id=?",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|e|e.to_string())?;
 match prior{
  None=>Ok(false),
  Some((s,p,w)) if s==store_id && p==printer && w==width=>Ok(true),
  Some(_)=>Err("ID de impressão com destino divergente. Consulte a fila.".into())
 }
}
pub fn enqueue(db:&Connection,j:&Job)->Result<(),String>{''')
patch('web/src-tauri/src/main.rs','#[tauri::command]fn list_jobs(',r'''#[tauri::command]fn has_saved_print_job(state:tauri::State<State>,id:String,store_id:String,printer:String,width:u16)->Result<bool,String>{
 if store(&state)?!=store_id{return Err("Loja diferente da sessão ativa".into())}
 queue::has_saved(&database(&state)?,&id,&store_id,&printer,width)
}
#[tauri::command]fn list_jobs(''')
patch('web/src-tauri/src/main.rs','enqueue_job,list_jobs','enqueue_job,has_saved_print_job,list_jobs')
# Probe before any branding, preferences or raster generation; keep the existing SQLite enqueue strict.
patch('web/printBridge.mjs',' for(const job of jobs){',""" for(const job of jobs){
  const identity={id:job.id,storeId:job.store_id,printer:job.printer,width:Number(job.width)};
  if(await call('has_saved_print_job',identity)===true){
   await ack({p_job:job.id,p_device:device,p_state:'saved',p_error:null});
   continue;
  }""")
p=Path('web/printBridge.mjs');s=p.read_text(encoding='utf-8')
start=s.index("  await call('enqueue_job',{job:")
end=s.index("\\n",start) if False else s.index("\n",start)
line=s[start:end]
assert line.endswith(');'),line
s=s[:start]+"  try{"+line.strip()+"}\n  catch(error){\n   // A concurrent replay may have won the durable write. Never replace or resend the first receipt.\n   if(await call('has_saved_print_job',identity)!==true)throw error;\n  }"+s[end:]
p.write_text(s,encoding='utf-8')
# Existing base transport tests now exercise the additional durable lookup.
p=Path('web/tests/printBridge.test.mjs');s=p.read_text(encoding='utf-8')
s=s.replace("call:async(cmd)=>steps.push(cmd)","call:async(cmd)=>{steps.push(cmd);return false}")
s=s.replace("['enqueue_job','ack']","['has_saved_print_job','enqueue_job','ack']")
s=s.replace("call:async(_,args)=>ids.push(args.job.id)","call:async(cmd,args)=>{if(cmd==='enqueue_job')ids.push(args.job.id);return false}")
p.write_text(s,encoding='utf-8')
p=Path('web/src-tauri/src/queue.rs')
with p.open('a',encoding='utf-8') as f:f.write(r'''
#[cfg(test)] mod saved_replay_tests{
 use super::*;
 #[test]fn saved_identity_preserves_first_receipt_and_never_resends_submitted(){
  let mut db=open(Path::new(":memory:")).unwrap();
  let mut j=Job{id:uuid::Uuid::new_v4().to_string(),store_id:uuid::Uuid::new_v4().to_string(),printer:"Thermal".into(),width:58,receipt:"first snapshot".into()};
  assert!(!has_saved(&db,&j.id,&j.store_id,&j.printer,j.width).unwrap());
  enqueue(&db,&j).unwrap();
  assert!(has_saved(&db,&j.id,&j.store_id,&j.printer,j.width).unwrap());
  j.receipt="new artwork".into();
  assert!(enqueue(&db,&j).is_err());
  assert!(has_saved(&db,&j.id,&j.store_id,&j.printer,j.width).unwrap());
  assert!(has_saved(&db,&j.id,&j.store_id,"Other printer",58).is_err());
  assert!(has_saved(&db,&j.id,&j.store_id,&j.printer,80).is_err());
  assert!(has_saved(&db,&j.id,&uuid::Uuid::new_v4().to_string(),&j.printer,58).is_err());
  let first=claim(&mut db,&j.store_id).unwrap().unwrap();
  assert_eq!(first.receipt,"first snapshot");
  finish(&db,&j.id,"submitted",None,Some(42)).unwrap();
  assert!(has_saved(&db,&j.id,&j.store_id,&j.printer,58).unwrap());
  assert!(claim(&mut db,&j.store_id).unwrap().is_none());
 }
}
''')
