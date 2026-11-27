// Fail-closed placeholder. Configure JWT verification and official marketplace
// API adapter before enabling. Never log or persist plaintext delivery codes.
Deno.serve(async (_request) => new Response(
  JSON.stringify({verified:false,error:'Integração oficial de verificação ainda não homologada'}),
  {status:501,headers:{'content-type':'application/json'}}
));
