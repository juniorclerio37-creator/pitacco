-- Vault-backed authentication for the EXISTING courier-push cron sender.
-- Generate the 256-bit secret entirely in Postgres. Never copy it to GitHub,
-- the Android application or the chat transcript.
do $create$
begin
 if not exists (select 1 from vault.secrets where name='pitacco_push_cron_secret') then
  perform vault.create_secret(
   encode(extensions.gen_random_bytes(32),'hex'),
   'pitacco_push_cron_secret',
   'Pitacco courier-push pg_cron bearer; server-only'
  );
 end if;
end;
$create$;

-- PostgREST is called with the Edge Function's service-role key; only that
-- role can execute this verifier. No endpoint returns the Vault secret.
create or replace function public.pitacco_verify_courier_push_cron(p_token text)
returns boolean language plpgsql stable security definer
set search_path=''
as $verify$
declare v_secret text;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return false;end if;
 select v.decrypted_secret into v_secret
 from vault.decrypted_secrets v
 where v.name='pitacco_push_cron_secret'
 limit 1;
 if v_secret is null then return false;end if;
 return extensions.digest(p_token,'sha256') =
        extensions.digest(v_secret,'sha256');
end;
$verify$;
revoke all on function public.pitacco_verify_courier_push_cron(text)
 from public,anon,authenticated;
grant execute on function public.pitacco_verify_courier_push_cron(text)
 to service_role;

-- Do not enable the sender until an official Firebase service-account secret
-- AND a registered, opted-in courier device have been verified.
notify pgrst,'reload schema';
