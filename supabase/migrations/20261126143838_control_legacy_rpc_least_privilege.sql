-- Restrict legacy RPCs whose implementation already requires an authenticated identity.
-- Some older installation baselines do not contain every legacy RPC. Missing routines
-- have no grants to revoke; check and harden every installed routine. Production contains all 17.
-- Keep the public storefront, token-authorized background RPCs and RLS helpers intact.
do $harden$
declare signature text; routine regprocedure;
begin
 foreach signature in array array['public.add_store_member(uuid,text,text)','public.append_delivery_to_batch(uuid,uuid,uuid)','public.assign_delivery(uuid,uuid)','public.create_delivery(uuid,text,text,text,numeric,numeric)','public.pitacco_claim_courier_invites()','public.pitacco_courier_statement(uuid,date,date)','public.pitacco_invite_courier(uuid,text,text,text)','public.pitacco_list_courier_invites(uuid)','public.pitacco_register_courier_payout_once(uuid,uuid,date,date,numeric,text,uuid)','public.pitacco_save_customer_branding(uuid,text,text)','public.register_courier(text,text,text,text,uuid)','public.register_marketplace_partner_delivery(uuid,text,text,text,text,text)','public.set_courier_availability(boolean)','public.set_delivery_status(uuid,text)','public.set_dispatch_policy(uuid,text,integer)','public.set_store_delivery_mode(uuid,text)','public.set_store_dispatch_mode(uuid,text)'] loop
  routine:=to_regprocedure(signature);
  if routine is null then
   raise notice 'Legacy RPC absent from this baseline: %',signature;
   continue;
  end if;
  execute format('revoke execute on function %s from public, anon',routine);
  execute format('grant execute on function %s to authenticated, service_role',routine);
  assert not has_function_privilege('anon',routine,'EXECUTE'),signature||': anonymous execution';
  assert has_function_privilege('authenticated',routine,'EXECUTE'),signature||': authenticated regression';
  assert has_function_privilege('service_role',routine,'EXECUTE'),signature||': service regression';
 end loop;
end $harden$;
do $verify$
declare signature text; routine regprocedure;
begin
 foreach signature in array array['public.get_public_menu(text)','public.checkout_public_order(text,uuid,text,text,text,jsonb,text,text,text)','public.pitacco_track_public_order(uuid)','public.pitacco_courier_background_assignments(text)'] loop
  routine:=to_regprocedure(signature);
  if routine is not null then assert has_function_privilege('anon',routine,'EXECUTE'),signature||': public entrypoint regression'; end if;
 end loop;
end $verify$;
