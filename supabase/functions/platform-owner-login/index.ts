import { createPlatformOwnerLogin } from './handler.mjs';

Deno.serve(createPlatformOwnerLogin({
  supabaseUrl: Deno.env.get('SUPABASE_URL'),
  publicKey: Deno.env.get('SUPABASE_ANON_KEY'),
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  additionalOrigin: Deno.env.get('PITACCO_ADMIN_HOMOLOGATION_ORIGIN'),
}));
