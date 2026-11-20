// All delivery area decisions happen on this server, never in client-side JS.
export const finiteBrazil=(lat,lng)=>Number.isFinite(lat)&&Number.isFinite(lng)
 &&lat>=-34&&lat<=6&&lng>=-75&&lng<=-32;
export const directDistance=(a,b)=>{
 const rad=Math.PI/180;
 const dLat=(b[0]-a[0])*rad,dLng=(b[1]-a[1])*rad;
 const h=Math.sin(dLat/2)**2+Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*Math.sin(dLng/2)**2;
 return Math.round(12742000*Math.asin(Math.sqrt(Math.min(1,h))));
};

const cross=(a,b,p)=>(b[1]-a[1])*(p[0]-a[0])-(b[0]-a[0])*(p[1]-a[1]);
function segmentContains(p,a,b){
 return Math.abs(cross(a,b,p))<1e-10&&
  p[0]>=Math.min(a[0],b[0])-1e-10&&p[0]<=Math.max(a[0],b[0])+1e-10&&
  p[1]>=Math.min(a[1],b[1])-1e-10&&p[1]<=Math.max(a[1],b[1])+1e-10;
}
export function polygonValid(vertices){
 if(vertices.length<3||vertices.length>30)return false;
 if(vertices.some(p=>!Array.isArray(p)||p.length!==2||!finiteBrazil(p[0],p[1])))return false;
 // Consecutive duplicate vertices and self-intersecting outlines are invalid.
 const n=vertices.length;
 for(let i=0;i<n;i++){
  const a=vertices[i],b=vertices[(i+1)%n];
  if(a[0]===b[0]&&a[1]===b[1])return false;
  for(let j=i+2;j<n;j++){
   if(i===0&&j===n-1)continue;
   const c=vertices[j],d=vertices[(j+1)%n];
   const s1=cross(a,b,c),s2=cross(a,b,d),s3=cross(c,d,a),s4=cross(c,d,b);
   if((s1*s2<0&&s3*s4<0)||
     segmentContains(a,c,d)||segmentContains(b,c,d)||
     segmentContains(c,a,b)||segmentContains(d,a,b))return false;
  }
 }
 const area=vertices.reduce((sum,p,i)=>sum+p[1]*vertices[(i+1)%n][0]-vertices[(i+1)%n][1]*p[0],0);
 return Math.abs(area)>1e-9;
}
export function withinPolygon(p,v){
 let inside=false;
 for(let i=0,j=v.length-1;i<v.length;j=i++){
  const a=v[i],b=v[j];
  if(segmentContains(p,a,b))return true;
  if((a[0]>p[0])!==(b[0]>p[0])){
   const x=(b[1]-a[1])*(p[0]-a[0])/(b[0]-a[0])+a[1];
   if(p[1]<x)inside=!inside;
  }
 }
 return inside;
}
