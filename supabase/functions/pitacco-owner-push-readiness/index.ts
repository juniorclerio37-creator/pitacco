import {createOwnerPushReadiness} from './handler.mjs';

Deno.serve(createOwnerPushReadiness({
 url:Deno.env.get('SUPABASE_URL'),
 serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
 cronSecret:Deno.env.get('PITACCO_PUSH_CRON_SECRET'),
 account:Deno.env.get('PITACCO_FCM_SERVICE_ACCOUNT')
}));
