import { createPlatformOwnerLogin } from './handler.mjs';

Deno.serve(createPlatformOwnerLogin({
  supabaseUrl: Deno.env.get('SUPABASE_URL'),
  publicKey: Deno.env.get('SUPABASE_ANON_KEY'),
  ownerUsername: Deno.env.get('PITACCO_ADMIN_USERNAME'),
  ownerEmail: Deno.env.get('PITACCO_ADMIN_AUTH_EMAIL'),
  additionalOrigin: Deno.env.get('PITACCO_ADMIN_HOMOLOGATION_ORIGIN'),
}));
