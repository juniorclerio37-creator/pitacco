// Keep the handle in the form, the canonical HTTPS URL in the shared database.
export function instagramHandle(value){
 const raw=String(value??'').trim();
 const match=raw.match(/^https:\/\/(?:www\.)?instagram\.com\/([a-z0-9_.]+)\/?$/i);
 return match?'@'+match[1]:raw;
}
export function instagramProfileUrl(value){
 const handle=instagramHandle(value).replace(/^@/,'');
 if(!handle)return '';
 if(!/^[a-z0-9_.]{1,30}$/i.test(handle))throw Error('Informe o @ do Instagram, sem espaços ou caracteres especiais.');
 return 'https://www.instagram.com/'+handle+'/';
}
export function deviceProposalAllowed(candidate,saved,maxDistance=500){
 if(!Array.isArray(candidate)||candidate.length!==2||!candidate.every(Number.isFinite)||
    candidate[0]<-34||candidate[0]>6||candidate[1]<-75||candidate[1]>-32)return false;
 if(!Array.isArray(saved)||saved.length!==2||!saved.every(Number.isFinite))return true;
 const rad=d=>d*Math.PI/180;
 const a=Math.sin(rad(candidate[0]-saved[0])/2)**2+Math.cos(rad(saved[0]))*Math.cos(rad(candidate[0]))*Math.sin(rad(candidate[1]-saved[1])/2)**2;
 return 6371000*2*Math.asin(Math.sqrt(Math.min(1,a)))<=maxDistance;
}
