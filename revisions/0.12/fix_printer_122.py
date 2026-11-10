"""Fix Windows GetPrinterW error 122 in the restored Rust printing module."""
from pathlib import Path

path = Path("web/src-tauri/src/printer.rs")
source = path.read_text(encoding="utf-8")
old = ''' let(mut status,mut needed)=(0u32,0u32);
 if GetPrinterW(h.0,6,(&mut status as *mut u32).cast(),4,&mut needed)==0{return Err(err(false,"Consultar impressora"))}'''
new = ''' // Query the required size first; some drivers need a larger buffer even for level 6.
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
 };'''
if source.count(old) != 1:
    raise RuntimeError("Original printer code changed; refusing to patch")
updated = source.replace(old, new)
# The preexisting EnumPrintersW allocation also used an unimported size_of symbol.
updated = updated.replace("size_of::<usize>()", "std::mem::size_of::<usize>()")
updated = updated.replace("std::mem::std::mem::size_of::<usize>()", "std::mem::size_of::<usize>()")
path.write_text(updated, encoding="utf-8")
