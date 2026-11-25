create table if not exists pitacco_private.pagbank_sandbox_registration (
 singleton boolean primary key default true check(singleton),
 status text not null check(status in ('creating','registered','rejected','uncertain')),
 attempt uuid not null,
 client_id text,
 credential_secret_id uuid,
 http_status integer,
 updated_at timestamptz not null default now()
);
alter table pitacco_private.pagbank_sandbox_registration enable row level security;
revoke all on pitacco_private.pagbank_sandbox_registration from public,anon,authenticated;
create or replace function public.pitacco_pagbank_sandbox_registration(p_action text,p_attempt uuid,p_client_id text default null,p_secret text default null,p_http integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r pitacco_private.pagbank_sandbox_registration%rowtype; v uuid;
begin
 if p_action='start' then
   insert into pitacco_private.pagbank_sandbox_registration(singleton,status,attempt) values(true,'creating',p_attempt) on conflict(singleton) do nothing;
   select * into r from pitacco_private.pagbank_sandbox_registration where singleton for update;
   if r.status='rejected' then
      update pitacco_private.pagbank_sandbox_registration set status='creating',attempt=p_attempt,http_status=null,updated_at=now() where singleton returning * into r;
   end if;
   return jsonb_build_object('status',r.status,'claimed',r.status='creating' and r.attempt=p_attempt,'client_id',r.client_id);
 end if;
 select * into r from pitacco_private.pagbank_sandbox_registration where singleton for update;
 if not found or r.attempt<>p_attempt or r.status<>'creating' then raise exception 'registration attempt unavailable'; end if;
 if p_action='save' then
  if p_client_id is null or length(p_client_id) not between 8 and 150 or p_secret is null or length(p_secret) not between 10 and 32000 then raise exception 'invalid registration'; end if;
  v:=vault.create_secret(p_secret,'pitacco_pagbank_connect_sandbox_credentials','PagBank Connect Sandbox application credentials');
  update pitacco_private.pagbank_sandbox_registration set status='registered',client_id=p_client_id,credential_secret_id=v,http_status=p_http,updated_at=now() where singleton;
 elsif p_action in ('rejected','uncertain') then
  update pitacco_private.pagbank_sandbox_registration set status=p_action,http_status=p_http,updated_at=now() where singleton;
 else raise exception 'invalid action'; end if;
 return jsonb_build_object('status',case when p_action='save' then 'registered' else p_action end,'client_id',p_client_id);
end $$;
revoke all on function public.pitacco_pagbank_sandbox_registration(text,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.pitacco_pagbank_sandbox_registration(text,uuid,text,text,integer) to service_role;