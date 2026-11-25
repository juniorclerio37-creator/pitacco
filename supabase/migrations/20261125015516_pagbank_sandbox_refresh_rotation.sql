alter table pitacco_private.pagbank_sandbox_accounts add column refresh_attempt uuid, add column refresh_status text not null default 'idle' check(refresh_status in ('idle','running','uncertain'));
create function public.pitacco_pagbank_sandbox_refresh(p_store uuid,p_action text,p_attempt uuid,p_credential jsonb default null,p_expires timestamptz default null,p_force boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a pitacco_private.pagbank_sandbox_accounts%rowtype; cred jsonb; app jsonb;
begin
 select * into a from pitacco_private.pagbank_sandbox_accounts where store_id=p_store for update;
 if not found then raise exception 'Conta individual indisponível';end if;
 select decrypted_secret::jsonb into cred from vault.decrypted_secrets where id=a.secret_id;
 if p_action='claim' then
  if a.refresh_status<>'idle' then return jsonb_build_object('claimed',false,'status',a.refresh_status);end if;
  if not p_force and (a.expires_at is null or a.expires_at>now()+interval '5 minutes') then return jsonb_build_object('claimed',false,'status','not_due');end if;
  if length(coalesce(cred->>'refresh_token',''))<10 then raise exception 'Nova autorização necessária';end if;
  select v.decrypted_secret::jsonb into app from pitacco_private.pagbank_sandbox_registration r join vault.decrypted_secrets v on v.id=r.credential_secret_id where r.singleton and r.status='registered';
  if app is null then raise exception 'Aplicação indisponível';end if;
  update pitacco_private.pagbank_sandbox_accounts set refresh_attempt=p_attempt,refresh_status='running' where store_id=p_store;
  return jsonb_build_object('claimed',true,'credential',cred,'app',app);
 end if;
 if a.refresh_status<>'running' or a.refresh_attempt is distinct from p_attempt then raise exception 'Renovação indisponível';end if;
 if p_action='uncertain' then
  update pitacco_private.pagbank_sandbox_accounts set refresh_status='uncertain' where store_id=p_store;
  return jsonb_build_object('status','uncertain');
 elsif p_action='finish' then
  if p_expires is null or p_expires<=now() or length(coalesce(p_credential->>'access_token',''))<10 or length(coalesce(p_credential->>'refresh_token',''))<10 or p_credential->>'refresh_token'=cred->>'refresh_token' or (p_credential ? 'account_id' and p_credential->>'account_id' is distinct from a.provider_account_id) then raise exception 'Resposta de renovação inválida';end if;
  cred:=cred||p_credential||jsonb_build_object('account_id',a.provider_account_id);
  perform vault.update_secret(a.secret_id,new_secret:=cred::text);
  update pitacco_private.pagbank_sandbox_accounts set expires_at=p_expires,refresh_status='idle',refresh_attempt=null where store_id=p_store;
  return jsonb_build_object('status','renewed','expires_at',p_expires);
 end if;
 raise exception 'Operação inválida';
end $$;
revoke all on function public.pitacco_pagbank_sandbox_refresh(uuid,text,uuid,jsonb,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.pitacco_pagbank_sandbox_refresh(uuid,text,uuid,jsonb,timestamptz,boolean) to service_role;