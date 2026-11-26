// Pure monetary simulation, deliberately conservative at cent boundaries.
export function calculateSalesOffer({base,cost,fee,fixed,margin,discount}){
 const raw=[base,cost,fee,fixed,margin,discount];
 if(raw.some(v=>v==null||String(v).trim()===''))return null;
 const [b,c,f,x,m,d]=raw.map(Number);
 if(![b,c,f,x,m,d].every(Number.isFinite)||b<=0||c<=0||f<0||x<0||m<0||d<0||f+m>=100||d>=100)return null;
 const minimum=Math.ceil((c+x)/(1-(f+m)/100)*100-1e-8)/100;
 const proposed=Math.floor(b*(1-d/100)*100+1e-8)/100;
 if(!Number.isFinite(minimum)||proposed<=0)return null;
 const contribution=proposed*(1-f/100)-c-x;
 const currentContribution=b*(1-f/100)-c-x;
 // Extra orders needed to preserve direct contribution if every order receives this offer.
 const requiredVolume=contribution>0&&currentContribution>0?Math.max(0,Math.ceil((currentContribution/contribution-1)*100-1e-8)):null;
 return {minimum,proposed,contribution,safe:proposed>=minimum,requiredVolume,maximumDiscount:minimum<=b?Math.floor((1-minimum/b)*10000+1e-8)/100:null};
}
