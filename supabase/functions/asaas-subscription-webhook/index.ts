import { createAsaasWebhook } from './handler.mjs';

Deno.serve(createAsaasWebhook({
  environment: Deno.env.get('ASAAS_ENVIRONMENT'),
  token: Deno.env.get('ASAAS_WEBHOOK_TOKEN'),
  apiKey: Deno.env.get('ASAAS_API_KEY'),
  supabaseUrl: Deno.env.get('SUPABASE_URL'),
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
}));
