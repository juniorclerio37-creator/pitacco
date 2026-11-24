import { createPaymentHomologation } from './handler.mjs';
Deno.serve(createPaymentHomologation({supabaseUrl:Deno.env.get('SUPABASE_URL'),publicKey:Deno.env.get('SUPABASE_ANON_KEY')}));
