import { createCourierPush } from './handler.mjs';
let account = null;
try { account = JSON.parse(Deno.env.get('PITACCO_FCM_SERVICE_ACCOUNT') ?? 'null'); } catch {}
Deno.serve(createCourierPush({
  url: Deno.env.get('SUPABASE_URL'),
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  cronSecret: Deno.env.get('PITACCO_PUSH_CRON_SECRET'),
  account
}));
