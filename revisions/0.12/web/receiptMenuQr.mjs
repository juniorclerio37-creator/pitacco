import {storefrontLink} from './storefrontLink.mjs';
// Fixed QR Model 2, version 5, error correction M (2 x 43 data + 24 ECC).
// The official maximum 60-character slug fits in the 84-byte capacity.
export function receiptMenuUrl(menu){
 return menu?.enabled===true?storefrontLink(menu.slug):'';
}
export async function loadReceiptMenuUrl(client,storeId){
 if(!client||!storeId)return '';
 try{const {data,error}=await client.rpc('pitacco_storefront_link',{p_store:storeId});return error?'':receiptMenuUrl(data)}catch{return ''}
}
function multiply(x,y){let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11d);z^=((y>>>i)&1)*x}return z}
function parity(data){
 const degree=24,div=Array(degree).fill(0);div[degree-1]=1;let root=1;
 for(let i=0;i<degree;i++){for(let j=0;j<degree;j++){div[j]=multiply(div[j],root);if(j+1<degree)div[j]^=div[j+1]}root=multiply(root,2)}
 const result=Array(degree).fill(0);
 for(const b of data){const factor=b^result.shift();result.push(0);for(let i=0;i<degree;i++)result[i]^=multiply(div[i],factor)}
 return result;
}
export function receiptQrMatrix(url){
 if(typeof url!=='string'||!/^https:\/\/pitacco\.com\.br\/[a-z0-9][a-z0-9-]{2,59}$/.test(url))throw Error('Endereço do cardápio inválido');
 const bytes=Array.from(url,c=>c.charCodeAt(0));if(bytes.length>84)throw Error('Endereço do cardápio muito longo');
 const bits=[],add=(value,n)=>{for(let i=n-1;i>=0;i--)bits.push((value>>>i)&1)};
 add(4,4);add(bytes.length,8);bytes.forEach(b=>add(b,8));add(0,Math.min(4,688-bits.length));while(bits.length%8)bits.push(0);
 const data=[];for(let i=0;i<bits.length;i+=8)data.push(bits.slice(i,i+8).reduce((a,b)=>(a<<1)|b,0));
 for(let pad=0;data.length<86;pad++)data.push(pad%2?0x11:0xec);
 const blocks=[data.slice(0,43),data.slice(43)],ecc=blocks.map(parity),words=[];
 for(let i=0;i<43;i++)for(const b of blocks)words.push(b[i]);for(let i=0;i<24;i++)for(const b of ecc)words.push(b[i]);
 const n=37,m=Array.from({length:n},()=>Array(n).fill(false)),fixed=Array.from({length:n},()=>Array(n).fill(false));
 function set(x,y,v){if(x<0||y<0||x>=n||y>=n)return;m[y][x]=!!v;fixed[y][x]=true}
 for(let i=0;i<n;i++){set(6,i,i%2===0);set(i,6,i%2===0)}
 for(const [cx,cy] of [[3,3],[n-4,3],[3,n-4]])for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const d=Math.max(Math.abs(dx),Math.abs(dy));set(cx+dx,cy+dy,d!==2&&d!==4)}
 for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(30+dx,30+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
 // M + mask 0, with BCH format protection.
 const format=0x5412,bit=i=>(format>>>i)&1;
 for(let i=0;i<=5;i++)set(8,i,bit(i));set(8,7,bit(6));set(8,8,bit(7));set(7,8,bit(8));
 for(let i=9;i<15;i++)set(14-i,8,bit(i));
 for(let i=0;i<8;i++)set(n-1-i,8,bit(i));
 for(let i=8;i<15;i++)set(8,n-15+i,bit(i));set(8,n-8,true);
 let p=0;
 for(let right=n-1;right>=1;right-=2){if(right===6)right=5;for(let v=0;v<n;v++){const y=((right+1)&2)===0?n-1-v:v;for(let j=0;j<2;j++){const x=right-j;if(fixed[y][x])continue;const val=p<words.length*8?((words[p>>>3]>>>(7-(p&7)))&1):0;m[y][x]=!!(val^((x+y)%2===0?1:0));p++}}}
 if(p!==words.length*8+7)throw Error('Falha ao montar QR Code');
 return m;
}
