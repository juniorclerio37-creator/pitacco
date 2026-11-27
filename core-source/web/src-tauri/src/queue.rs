use rusqlite::{params,Connection,OptionalExtension};
use serde::{Deserialize,Serialize};
use std::path::Path;
#[derive(Debug,Clone,Deserialize,Serialize)]
pub struct Job { pub id:String,pub store_id:String,pub printer:String,pub width:u16,pub receipt:String }
#[derive(Serialize)]
pub struct JobState {pub id:String,pub store_id:String,pub state:String,pub error:Option<String>,pub attempts:i64,pub spool_id:Option<i64>}
pub fn open(path:&Path)->Result<Connection,String>{let db=Connection::open(path).map_err(|e|e.to_string())?;db.execute_batch(include_str!("queue.sql")).map_err(|e|e.to_string())?;Ok(db)}
pub fn recover(db:&Connection)->Result<(),String>{db.execute("UPDATE jobs SET state='uncertain',error='Aplicativo interrompido durante envio. Verifique papel/spooler antes de reimprimir.',updated_at=unixepoch() WHERE state='printing'",[]).map_err(|e|e.to_string())?;Ok(())}

pub fn has_saved(db:&Connection,id:&str,store_id:&str,printer:&str,width:u16)->Result<bool,String>{
 if uuid::Uuid::parse_str(id).is_err() || uuid::Uuid::parse_str(store_id).is_err() || ![58,80].contains(&width){return Err("Trabalho inválido".into())}
 let prior:Option<(String,String,u16)>=db.query_row("SELECT store_id,printer,width FROM jobs WHERE id=?",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|e|e.to_string())?;
 match prior{
  None=>Ok(false),
  Some((s,p,w)) if s==store_id && p==printer && w==width=>Ok(true),
  Some(_)=>Err("ID de impressão com destino divergente. Consulte a fila.".into())
 }
}
pub fn enqueue(db:&Connection,j:&Job)->Result<(),String>{
 if uuid::Uuid::parse_str(&j.id).is_err() || uuid::Uuid::parse_str(&j.store_id).is_err() || ![58,80].contains(&j.width) || j.printer.trim().is_empty() || j.printer.len()>256 || j.printer.contains('\0') || (j.receipt.len()>65536 && (!j.receipt.starts_with("PITACCO_RASTER_V1:") || j.receipt.len()>2_000_000)) {return Err("Trabalho inválido".into())}
 let prior:Option<(String,String,u16,String)>=db.query_row("SELECT store_id,printer,width,receipt FROM jobs WHERE id=?",[&j.id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(|e|e.to_string())?;
 if let Some(p)=prior {if p!=(j.store_id.clone(),j.printer.clone(),j.width,j.receipt.clone()){return Err("ID repetido com conteúdo divergente".into())}return Ok(())}
 db.execute("INSERT INTO jobs(id,store_id,printer,width,receipt) VALUES(?,?,?,?,?)",params![j.id,j.store_id,j.printer,j.width,j.receipt]).map_err(|e|e.to_string())?;Ok(())
}
pub fn claim(db:&mut Connection,store:&str)->Result<Option<Job>,String>{
 let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
 let job=tx.query_row("SELECT id,store_id,printer,width,receipt FROM jobs WHERE store_id=? AND (state='queued' OR (state='error' AND attempts<5)) AND next_attempt<=unixepoch() ORDER BY created_at,id LIMIT 1",[store],|r|Ok(Job{id:r.get(0)?,store_id:r.get(1)?,printer:r.get(2)?,width:r.get(3)?,receipt:r.get(4)?})).optional().map_err(|e|e.to_string())?;
 if let Some(ref j)=job {tx.execute("UPDATE jobs SET state='printing',attempts=attempts+1,updated_at=unixepoch() WHERE id=?",[&j.id]).map_err(|e|e.to_string())?;}
 tx.commit().map_err(|e|e.to_string())?;Ok(job)
}
pub fn finish(db:&Connection,id:&str,state:&str,error:Option<&str>,spool:Option<u32>)->Result<(),String>{
 if !["submitted","error","uncertain"].contains(&state){return Err("Estado inválido".into())}
 db.execute("UPDATE jobs SET state=?,error=?,spool_id=?,next_attempt=unixepoch()+min(300,5*(1 << min(attempts,6))),updated_at=unixepoch() WHERE id=? AND state='printing'",params![state,error,spool,id]).map_err(|e|e.to_string())?;Ok(())
}
pub fn list(db:&Connection,store:&str)->Result<Vec<JobState>,String>{let mut q=db.prepare("SELECT id,store_id,state,error,attempts,spool_id FROM jobs WHERE store_id=? ORDER BY created_at DESC,id LIMIT 500").map_err(|e|e.to_string())?;let rows=q.query_map([store],|r|Ok(JobState{id:r.get(0)?,store_id:r.get(1)?,state:r.get(2)?,error:r.get(3)?,attempts:r.get(4)?,spool_id:r.get(5)?})).map_err(|e|e.to_string())?;rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())}
pub fn retry(db:&mut Connection,id:&str,store:&str)->Result<(),String>{let tx=db.transaction().map_err(|e|e.to_string())?;let n=tx.execute("UPDATE jobs SET state='queued',attempts=0,next_attempt=0,error=NULL WHERE id=? AND store_id=? AND state='error'",params![id,store]).map_err(|e|e.to_string())?;if n!=1{return Err("Só falhas anteriores ao envio podem ser tentadas novamente. Para resultado incerto, solicite reimpressão auditada.".into())}tx.execute("INSERT INTO audit(job_id,action) VALUES(?,'retry-before-send')",[id]).map_err(|e|e.to_string())?;tx.commit().map_err(|e|e.to_string())}
#[cfg(test)] mod tests {
 use super::*;
 fn job()->Job{Job{id:uuid::Uuid::new_v4().to_string(),store_id:uuid::Uuid::new_v4().to_string(),printer:"TEST".into(),width:58,receipt:"Pedido".into()}}
 #[test]fn dedupe_and_conflict(){let db=open(Path::new(":memory:")).unwrap();let mut j=job();enqueue(&db,&j).unwrap();enqueue(&db,&j).unwrap();assert_eq!(list(&db,&j.store_id).unwrap().len(),1);j.receipt="changed".into();assert!(enqueue(&db,&j).is_err())}
 #[test]fn crash_is_uncertain_and_not_retried(){let mut db=open(Path::new(":memory:")).unwrap();let j=job();enqueue(&db,&j).unwrap();claim(&mut db,&j.store_id).unwrap().unwrap();recover(&db).unwrap();assert!(claim(&mut db,&j.store_id).unwrap().is_none());assert!(retry(&mut db,&j.id,&j.store_id).is_err())}
 #[test]fn isolation_and_safe_retry(){let mut db=open(Path::new(":memory:")).unwrap();let j=job();enqueue(&db,&j).unwrap();assert!(claim(&mut db,"other").unwrap().is_none());claim(&mut db,&j.store_id).unwrap();finish(&db,&j.id,"error",Some("offline"),None).unwrap();retry(&mut db,&j.id,&j.store_id).unwrap();assert!(claim(&mut db,&j.store_id).unwrap().is_some())}
}
#[cfg(test)] mod durability_tests {
 use super::*;
 #[test] fn survives_process_reopen_and_does_not_resend_submitted(){
 let path=std::env::temp_dir().join(format!("dg-test-{}.sqlite3",uuid::Uuid::new_v4()));
 let j=Job{id:uuid::Uuid::new_v4().to_string(),store_id:uuid::Uuid::new_v4().to_string(),printer:"Fake thermal".into(),width:80,receipt:"Pedido teste".into()};
 {let db=open(&path).unwrap();enqueue(&db,&j).unwrap();}
 {let mut db=open(&path).unwrap();assert!(claim(&mut db,&j.store_id).unwrap().is_some());finish(&db,&j.id,"submitted",None,Some(42)).unwrap();}
 {let mut db=open(&path).unwrap();recover(&db).unwrap();enqueue(&db,&j).unwrap();assert!(claim(&mut db,&j.store_id).unwrap().is_none());assert_eq!(list(&db,&j.store_id).unwrap()[0].spool_id,Some(42));}
 std::fs::remove_file(path).unwrap();
 }
 #[test] fn stops_automatic_retry_after_five_safe_failures(){
 let mut db=open(Path::new(":memory:")).unwrap();let j=Job{id:uuid::Uuid::new_v4().to_string(),store_id:uuid::Uuid::new_v4().to_string(),printer:"Fake".into(),width:80,receipt:"Test".into()};enqueue(&db,&j).unwrap();
 for _ in 0..5{assert!(claim(&mut db,&j.store_id).unwrap().is_some());finish(&db,&j.id,"error",Some("offline before spool"),None).unwrap();db.execute("UPDATE jobs SET next_attempt=0",[]).unwrap();}
 assert!(claim(&mut db,&j.store_id).unwrap().is_none());assert_eq!(list(&db,&j.store_id).unwrap()[0].attempts,5);
 }
}

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
