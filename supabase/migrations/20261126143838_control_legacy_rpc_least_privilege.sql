-- Restrict legacy RPCs whose implementation already requires an authenticated identity.
-- Do not modify checkout, public menu, tracking, anonymous background-token RPCs,
-- RLS helper functions or trigger definitions. Preserve authenticated and service roles.
revoke execute on function public.add_store_member(uuid,text,text) from public, anon;
grant execute on function public.add_store_member(uuid,text,text) to authenticated, service_role;
revoke execute on function public.append_delivery_to_batch(uuid,uuid,uuid) from public, anon;
grant execute on function public.append_delivery_to_batch(uuid,uuid,uuid) to authenticated, service_role;
revoke execute on function public.assign_delivery(uuid,uuid) from public, anon;
grant execute on function public.assign_delivery(uuid,uuid) to authenticated, service_role;
revoke execute on function public.create_delivery(uuid,text,text,text,numeric,numeric) from public, anon;
grant execute on function public.create_delivery(uuid,text,text,text,numeric,numeric) to authenticated, service_role;
revoke execute on function public.pitacco_claim_courier_invites() from public, anon;
grant execute on function public.pitacco_claim_courier_invites() to authenticated, service_role;
revoke execute on function public.pitacco_courier_statement(uuid,date,date) from public, anon;
grant execute on function public.pitacco_courier_statement(uuid,date,date) to authenticated, service_role;
revoke execute on function public.pitacco_invite_courier(uuid,text,text,text) from public, anon;
grant execute on function public.pitacco_invite_courier(uuid,text,text,text) to authenticated, service_role;
revoke execute on function public.pitacco_list_courier_invites(uuid) from public, anon;
grant execute on function public.pitacco_list_courier_invites(uuid) to authenticated, service_role;
revoke execute on function public.pitacco_register_courier_payout_once(uuid,uuid,date,date,numeric,text,uuid) from public, anon;
grant execute on function public.pitacco_register_courier_payout_once(uuid,uuid,date,date,numeric,text,uuid) to authenticated, service_role;
revoke execute on function public.pitacco_save_customer_branding(uuid,text,text) from public, anon;
grant execute on function public.pitacco_save_customer_branding(uuid,text,text) to authenticated, service_role;
revoke execute on function public.register_courier(text,text,text,text,uuid) from public, anon;
grant execute on function public.register_courier(text,text,text,text,uuid) to authenticated, service_role;
revoke execute on function public.register_marketplace_partner_delivery(uuid,text,text,text,text,text) from public, anon;
grant execute on function public.register_marketplace_partner_delivery(uuid,text,text,text,text,text) to authenticated, service_role;
revoke execute on function public.set_courier_availability(boolean) from public, anon;
grant execute on function public.set_courier_availability(boolean) to authenticated, service_role;
revoke execute on function public.set_delivery_status(uuid,text) from public, anon;
grant execute on function public.set_delivery_status(uuid,text) to authenticated, service_role;
revoke execute on function public.set_dispatch_policy(uuid,text,integer) from public, anon;
grant execute on function public.set_dispatch_policy(uuid,text,integer) to authenticated, service_role;
revoke execute on function public.set_store_delivery_mode(uuid,text) from public, anon;
grant execute on function public.set_store_delivery_mode(uuid,text) to authenticated, service_role;
revoke execute on function public.set_store_dispatch_mode(uuid,text) from public, anon;
grant execute on function public.set_store_dispatch_mode(uuid,text) to authenticated, service_role;
do $verify$
declare signature text;
begin
 foreach signature in array array['public.add_store_member(uuid,text,text)','public.append_delivery_to_batch(uuid,uuid,uuid)','public.assign_delivery(uuid,uuid)','public.create_delivery(uuid,text,text,text,numeric,numeric)','public.pitacco_claim_courier_invites()','public.pitacco_courier_statement(uuid,date,date)','public.pitacco_invite_courier(uuid,text,text,text)','public.pitacco_list_courier_invites(uuid)','public.pitacco_register_courier_payout_once(uuid,uuid,date,date,numeric,text,uuid)','public.pitacco_save_customer_branding(uuid,text,text)','public.register_courier(text,text,text,text,uuid)','public.register_marketplace_partner_delivery(uuid,text,text,text,text,text)','public.set_courier_availability(boolean)','public.set_delivery_status(uuid,text)','public.set_dispatch_policy(uuid,text,integer)','public.set_store_delivery_mode(uuid,text)','public.set_store_dispatch_mode(uuid,text)'] loop
  assert not has_function_privilege('anon',signature,'EXECUTE'),signature||': anonymous execution';
  assert has_function_privilege('authenticated',signature,'EXECUTE'),signature||': authenticated regression';
  assert has_function_privilege('service_role',signature,'EXECUTE'),signature||': service regression';
 end loop;
 assert has_function_privilege('anon','public.get_public_menu(text)','EXECUTE');
 assert has_function_privilege('anon','public.checkout_public_order(text,uuid,text,text,text,jsonb,text,text,text)','EXECUTE');
 assert has_function_privilege('anon','public.pitacco_track_public_order(uuid)','EXECUTE');
 assert has_function_privilege('anon','public.pitacco_courier_background_assignments(text)','EXECUTE');
end $verify$;
