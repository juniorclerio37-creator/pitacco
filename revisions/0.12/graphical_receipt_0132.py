"""Use graphical ESC/POS receipts in the existing durable print pipeline."""
from pathlib import Path
def replace(path,old,new):
 p=Path(path);s=p.read_text(encoding='utf-8')
 assert s.count(old)==1, f'Unexpected print anchor: {path}: {old[:80]}'
 p.write_text(s.replace(old,new,1),encoding='utf-8')
p=Path('web/printBridge.mjs');s=p.read_text(encoding='utf-8')
p.write_text("import {rasterReceipt} from './receiptArtwork.mjs';\nimport {readPrintPreferences} from './printPreferences.mjs';\n"+s,encoding='utf-8')
replace('web/printBridge.mjs','ingestJobs({jobs,device,call,ack})','ingestJobs({jobs,device,call,ack,storeName})')
replace('web/Operations.jsx',"ingestJobs({jobs:remote||[],device,call:invoke,ack:args=>rpc('ack_print_job',args)})","ingestJobs({jobs:remote||[],device,call:invoke,ack:args=>rpc('ack_print_job',args),storeName})")
replace('web/printBridge.mjs','receipt:receiptText(job)',"receipt:typeof document!=='undefined'&&job.receipt?rasterReceipt(job,job.width,{...readPrintPreferences(job.store_id),storeName}):receiptText(job)")
replace('web/src-tauri/src/queue.rs','j.receipt.len()>65536','(j.receipt.len()>65536 && (!j.receipt.starts_with("PITACCO_RASTER_V1:") || j.receipt.len()>2_000_000))')
p=Path('web/src-tauri/src/printer.rs')
s=p.read_text(encoding='utf-8')
marker='pub fn receipt_bytes(text:&str,width:u16)->Vec<u8>{'
assert s.count(marker)==1
raster=r'''
/// Decode only bounded monochrome pixels; never accept arbitrary ESC/POS commands.
pub fn raster_bytes(text:&str,width:u16)->Option<Vec<u8>>{
 let mut parts=text.strip_prefix("PITACCO_RASTER_V1:")?.splitn(3,':');
 let w:usize=parts.next()?.parse().ok()?;let h:usize=parts.next()?.parse().ok()?;
 let encoded=parts.next()?.as_bytes();let expected=if width==58{384}else{576};
 if w!=expected||h==0||h>16000||encoded.len()>2_000_000||encoded.len()%4!=0{return None}
 let count=w/8*h;let mut pixels=Vec::with_capacity(count);
 fn b64(c:u8)->Option<u8>{match c{b'A'..=b'Z'=>Some(c-b'A'),b'a'..=b'z'=>Some(c-b'a'+26),b'0'..=b'9'=>Some(c-b'0'+52),b'+'=>Some(62),b'/'=>Some(63),_=>None}}
 let groups=encoded.len()/4;
 for (i,q) in encoded.chunks_exact(4).enumerate(){
  let a=b64(q[0])?;let b=b64(q[1])?;pixels.push((a<<2)|(b>>4));
  if q[2]==b'=' {if q[3]!=b'='||i+1!=groups{return None}}
  else{let c=b64(q[2])?;pixels.push((b<<4)|(c>>2));if q[3]==b'=' {if i+1!=groups{return None}}else{pixels.push((c<<6)|b64(q[3])?);}}
  if pixels.len()>count{return None}
 }
 if pixels.len()!=count{return None}
 let row=w/8;let mut out=vec![0x1b,0x40,0x1b,0x61,0];
 for band in pixels.chunks(row*128){
  let n=band.len()/row;
  out.extend_from_slice(&[0x1d,0x76,0x30,0,row as u8,(row>>8) as u8,n as u8,(n>>8) as u8]);
  out.extend_from_slice(band);
 }
 out.extend_from_slice(b"\n\n\n");out.extend_from_slice(&[0x1d,0x56,0x42,0]);Some(out)
}
#[cfg(test)] mod raster_tests{
 use super::*;
 #[test] fn rejects_invalid_raster(){assert!(raster_bytes("PITACCO_RASTER_V1:576:1:AAAA",58).is_none());assert!(raster_bytes("PITACCO_RASTER_V1:384:1:AAAA",58).is_none());}
 #[test] fn sends_bounded_graphic(){let s=format!("PITACCO_RASTER_V1:384:1:{}","A".repeat(64));let v=raster_bytes(&s,58).unwrap();assert!(v.windows(8).any(|x|x==[0x1d,0x76,0x30,0,48,0,1,0]));}
}
'''
s=s.replace(marker,raster+'\n'+marker+'\n if let Some(bytes)=raster_bytes(text,width){return bytes;}',1)
p.write_text(s,encoding='utf-8')
# Reject malformed raster before committing it to SQLite or acknowledging the server.
replace('web/src-tauri/src/main.rs','queue::enqueue(&database(&state)?,&job)', 'if job.receipt.starts_with("PITACCO_RASTER_V1:") && printer::raster_bytes(&job.receipt,job.width).is_none(){return Err("Imagem da comanda inválida".into())}queue::enqueue(&database(&state)?,&job)')
