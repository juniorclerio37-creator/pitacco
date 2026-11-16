// Request IDs are created only when an operation starts and kept across retries.
export function operationRequestId() {
 const source=globalThis.crypto;
 if(source?.randomUUID)return source.randomUUID();
 if(!source?.getRandomValues)throw new Error('Este navegador não consegue gerar um código seguro para o pedido.');
 const bytes=source.getRandomValues(new Uint8Array(16));
 bytes[6]=(bytes[6]&0x0f)|0x40;
 bytes[8]=(bytes[8]&0x3f)|0x80;
 const hex=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
 return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
