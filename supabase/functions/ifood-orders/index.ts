import { createIfoodOrders } from './handler.mjs';

Deno.serve(createIfoodOrders({
  shippingTest: true,
  productionId: Deno.env.get('IFOOD_PRODUCTION_CLIENT_ID'),
  productionSecret: Deno.env.get('IFOOD_PRODUCTION_CLIENT_SECRET'),
  clientId: Deno.env.get('IFOOD_CLIENT_ID'),
  clientSecret: Deno.env.get('IFOOD_CLIENT_SECRET'),
  distributedId: Deno.env.get('IFOOD_DISTRIBUTED_CLIENT_ID'),
  distributedSecret: Deno.env.get('IFOOD_DISTRIBUTED_CLIENT_SECRET'),
  tokenKey: Deno.env.get('IFOOD_TOKEN_KEY'),
  publicKey: Deno.env.get('SUPABASE_ANON_KEY'),
  supabaseUrl: Deno.env.get('SUPABASE_URL'),
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  runInBackground: (promise: Promise<unknown>) => EdgeRuntime.waitUntil(promise),
}));
