use unicode_normalization::UnicodeNormalization;
/// ASCII mode deliberately avoids model-specific code pages and strips control codes.
/// All ESC/POS commands are ours, never taken from customer/order data.

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

pub fn receipt_bytes(text:&str,width:u16)->Vec<u8>{
 if let Some(bytes)=raster_bytes(text,width){return bytes;}
 let columns=if width==58 {32}else{48};let mut out=vec![0x1b,0x40];
 for line in text.nfkd().collect::<String>().lines(){let clean:String=line.chars().filter(|c|c.is_ascii()&&!c.is_ascii_control()).collect();
  if clean.is_empty(){out.push(b'\n');}else{for part in clean.as_bytes().chunks(columns){out.extend_from_slice(part);out.push(b'\n');}}
 }
 out.extend_from_slice(b"\n\n\n");out.extend_from_slice(&[0x1d,0x56,0x42,0]);out
}
#[derive(Debug)]pub struct PrintError{pub uncertain:bool,pub message:String}
#[cfg(not(windows))]pub fn printers()->Result<Vec<String>,String>{Err("Impressão disponível apenas no Windows".into())}
#[cfg(not(windows))]pub fn send(_printer:&str,_bytes:&[u8])->Result<u32,PrintError>{Err(PrintError{uncertain:false,message:"Windows necessário".into()})}
#[cfg(windows)]mod win {
 use super::PrintError;use std::{ffi::c_void,ptr};
 type Handle=*mut c_void;
 #[repr(C)]struct Doc {name:*mut u16,output:*mut u16,datatype:*mut u16}
 #[repr(C)]struct Info4 {name:*mut u16,server:*mut u16,attributes:u32}
 #[link(name="winspool")]unsafe extern "system" {
 fn OpenPrinterW(name:*const u16,handle:*mut Handle,defaults:*mut c_void)->i32;
 fn ClosePrinter(handle:Handle)->i32;
 fn GetPrinterW(handle:Handle,level:u32,data:*mut u8,size:u32,needed:*mut u32)->i32;
 fn EnumPrintersW(flags:u32,name:*const u16,level:u32,data:*mut u8,size:u32,needed:*mut u32,count:*mut u32)->i32;
 fn StartDocPrinterW(handle:Handle,level:u32,doc:*const Doc)->u32;
 fn StartPagePrinter(handle:Handle)->i32;
 fn WritePrinter(handle:Handle,data:*const c_void,size:u32,written:*mut u32)->i32;
 fn EndPagePrinter(handle:Handle)->i32;
 fn EndDocPrinter(handle:Handle)->i32;
 }
 struct Owned(Handle);impl Drop for Owned{fn drop(&mut self){unsafe{ClosePrinter(self.0);}}}
 fn wide(s:&str)->Vec<u16>{s.encode_utf16().chain(Some(0)).collect()}
 fn err(uncertain:bool,stage:&str)->PrintError{PrintError{uncertain,message:format!("{}: {}",stage,std::io::Error::last_os_error())}}
 pub fn printers()->Result<Vec<String>,String>{unsafe{
 let(mut needed,mut count)=(0,0);EnumPrintersW(6,ptr::null(),4,ptr::null_mut(),0,&mut needed,&mut count);
 if needed==0{return Ok(vec![])}
 // usize allocation provides alignment required by PRINTER_INFO_4W.
 let mut buffer=vec![0usize;(needed as usize+std::mem::size_of::<usize>()-1)/std::mem::size_of::<usize>()];
 if EnumPrintersW(6,ptr::null(),4,buffer.as_mut_ptr().cast(),needed,&mut needed,&mut count)==0{return Err(std::io::Error::last_os_error().to_string())}
 let records=std::slice::from_raw_parts(buffer.as_ptr().cast::<Info4>(),count as usize);let mut names=vec![];
 for r in records{if !r.name.is_null(){let mut len=0;while *r.name.add(len)!=0&&len<32768{len+=1}names.push(String::from_utf16_lossy(std::slice::from_raw_parts(r.name,len)));}}
 names.sort();names.dedup();Ok(names)
 }}
 pub fn send(printer:&str,bytes:&[u8])->Result<u32,PrintError>{unsafe{
 let name=wide(printer);let mut raw=ptr::null_mut();
 if OpenPrinterW(name.as_ptr(),&mut raw,ptr::null_mut())==0{return Err(err(false,"Abrir impressora"))}let h=Owned(raw);
 // Query the required size first; some drivers need a larger buffer even for level 6.
 let mut needed=0u32;
 GetPrinterW(h.0,6,ptr::null_mut(),0,&mut needed);
 let mut capacity=needed.max(std::mem::size_of::<u32>() as u32) as usize;
 let status=loop {
  let mut buffer=vec![0usize;(capacity+std::mem::size_of::<usize>()-1)/std::mem::size_of::<usize>()];
  let mut required=0u32;
  if GetPrinterW(h.0,6,buffer.as_mut_ptr().cast(),capacity as u32,&mut required)!=0 {
   break *(buffer.as_ptr().cast::<u32>());
  }
  let cause=std::io::Error::last_os_error();
  if cause.raw_os_error()!=Some(122) || required as usize<=capacity || required as usize>1024*1024 {
   return Err(PrintError{uncertain:false,message:format!("Consultar impressora: {cause} (buffer={capacity}, necessário={required})")});
  }
  capacity=required as usize;
 };
 // paused, error, paper jam/out/problem, offline, output bin full, not available,
 // no toner, user intervention, door open. Busy/printing are not failures.
 if status & (1|2|8|16|64|128|2048|4096|262144|1048576|4194304)!=0{return Err(PrintError{uncertain:false,message:format!("Impressora indisponível, estado Windows 0x{status:x}")})}
 let mut title=wide("DeliveryGestor - comanda");let mut datatype=wide("RAW");let doc=Doc{name:title.as_mut_ptr(),output:ptr::null_mut(),datatype:datatype.as_mut_ptr()};
 let id=StartDocPrinterW(h.0,1,&doc);if id==0{return Err(err(false,"Criar trabalho no spooler"))}
 // Once Windows creates a document, any failure is ambiguous: never auto resend.
 if StartPagePrinter(h.0)==0{return Err(err(true,"Iniciar página"))}
 let mut written=0;
 if WritePrinter(h.0,bytes.as_ptr().cast(),bytes.len() as u32,&mut written)==0||written!=bytes.len() as u32{return Err(err(true,"Envio parcial ou falha de escrita"))}
 if EndPagePrinter(h.0)==0{return Err(err(true,"Finalizar página"))}
 if EndDocPrinter(h.0)==0{return Err(err(true,"Finalizar documento"))}
 Ok(id)
 }}
}
#[cfg(windows)]pub use win::{printers,send};
#[cfg(test)]mod tests{use super::*;#[test]fn strips_injected_controls_and_wraps(){let b=receipt_bytes("Açaí\u{1b}\u{0}teste\n123456789012345678901234567890123456",58);assert!(b.windows(9).any(|x|x==b"Acaiteste"));assert_eq!(b.iter().filter(|&&x|x==0x1b).count(),1);assert!(String::from_utf8_lossy(&b).contains("12345678901234567890123456789012\n3456"));}}
