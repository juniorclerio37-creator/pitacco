import { createAsaasHomologation } from './handler.mjs';

Deno.serve(createAsaasHomologation({
  supabaseUrl: Deno.env.get('SUPABASE_URL'),
  publicKey: Deno.env.get('SUPABASE_ANON_KEY'),
  sandboxKey: Deno.env.get('ASAAS_SANDBOX_API_KEY'),
  additionalOrigin: Deno.env.get('PITACCO_HOMOLOGATION_ORIGIN'),
}));
