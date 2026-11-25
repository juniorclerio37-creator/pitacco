create table pitacco_private.pagbank_sandbox_states(
 state uuid primary key, store_id uuid not null references public.stores(id), actor uuid, expires_at timestamptz not null default now()+interval '10 minutes', used_at timestamptz
);
create table pitacco_private.pagbank_sandbox_accounts(
 store_id uuid primary key references public.stores(id), secret_id uuid not null, expires_at timestamptz, connected_at timestamptz not null default now()
);
create table pitacco_private.pagbank_sandbox_pix(
 id uuid primary key, store_id uuid references public.stores(id), cents integer not null check(cents between 1 and 10000),
 status text not null default 'CREATING' check(status in ('CREATING','WAITING','PAID','DECLINED','CANCELED','REFUNDED','UNCERTAIN')),
 order_id text unique, charge_id text unique, qr_text text, qr_id text, expires_at timestamptz not null, updated_at timestamptz not null default now()
);
alter table pitacco_private.pagbank_sandbox_states enable row level security;
alter table pitacco_private.pagbank_sandbox_accounts enable row level security;
alter table pitacco_private.pagbank_sandbox_pix enable row level security;
revoke all on pitacco_private.pagbank_sandbox_states,pitacco_private.pagbank_sandbox_accounts,pitacco_private.pagbank_sandbox_pix from public,anon,authenticated;
create function public.pitacco_pagbank_sandbox(p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; st uuid; cid uuid; a pitacco_private.pagbank_sandbox_accounts%rowtype; c pitacco_private.pagbank_sandbox_pix%rowtype; v jsonb; reg pitacco_private.pagbank_sandbox_registration%rowtype; sec uuid;
begin
 sid:=nullif(p_data->>'store','')::uuid; st:=nullif(p_data->>'state','')::uuid; cid:=nullif(p_data->>'id','')::uuid;
 if p_action='app' then
   select * into reg from pitacco_private.pagbank_sandbox_registration where singleton and status='registered';
   if not found then raise exception 'sandbox app missing'; end if;
   return (select decrypted_secret::jsonb from vault.decrypted_secrets where id=reg.credential_secret_id);
 elsif p_action='start' then
   if sid is null or not exists(select 1 from pitacco_private.ifood_merchants where store_id=sid and test_only) then raise exception 'sandbox store required'; end if;
   if exists(select 1 from pitacco_private.pagbank_sandbox_accounts where store_id=sid) then raise exception 'already connected'; end if;
   insert into pitacco_private.pagbank_sandbox_states(state,store_id,actor) values(st,sid,nullif(p_data->>'actor','')::uuid);
   return jsonb_build_object('state',st);
 elsif p_action='consume' then
   update pitacco_private.pagbank_sandbox_states set used_at=now() where state=st and used_at is null and expires_at>now() returning store_id into sid;
   if not found then raise exception 'invalid or expired state'; end if;
   return jsonb_build_object('store',sid);
 elsif p_action='connect' then
   if not exists(select 1 from pitacco_private.pagbank_sandbox_states where state=st and store_id=sid and used_at is not null and used_at>now()-interval '2 minutes') then raise exception 'invalid state'; end if;
   if length(coalesce(p_data->'credential'->>'access_token',''))<10 then raise exception 'invalid access token'; end if;
   if exists(select 1 from pitacco_private.pagbank_sandbox_accounts where store_id=sid) then raise exception 'already connected'; end if;
   sec:=vault.create_secret((p_data->'credential')::text,'pitacco_pagbank_sandbox_store_'||sid,'PagBank Sandbox seller credentials');
   insert into pitacco_private.pagbank_sandbox_accounts(store_id,secret_id,expires_at) values(sid,sec,nullif(p_data->>'expires_at','')::timestamptz);
   return jsonb_build_object('connected',true);
 elsif p_action='account' then
   select * into a from pitacco_private.pagbank_sandbox_accounts where store_id=sid;
   if not found then return null; end if;
   return jsonb_build_object('credential',(select decrypted_secret::jsonb from vault.decrypted_secrets where id=a.secret_id),'expires_at',a.expires_at);
 elsif p_action='status' then
   select * into a from pitacco_private.pagbank_sandbox_accounts where store_id=sid;
   return jsonb_build_object('connected',found,'expires_at',a.expires_at);
 elsif p_action='reserve' then
   if sid is not null and not exists(select 1 from pitacco_private.pagbank_sandbox_accounts where store_id=sid and (expires_at is null or expires_at>now())) then raise exception 'sandbox seller not connected'; end if;
   insert into pitacco_private.pagbank_sandbox_pix(id,store_id,cents,expires_at) values(cid,sid,(p_data->>'cents')::integer,(p_data->>'expires_at')::timestamptz) on conflict(id) do nothing;
   select * into c from pitacco_private.pagbank_sandbox_pix where id=cid;
   if c.store_id is distinct from sid or c.cents<>(p_data->>'cents')::integer then raise exception 'invalid charge'; end if;
   return to_jsonb(c);
 elsif p_action='get' then
   select * into c from pitacco_private.pagbank_sandbox_pix where id=cid or (p_data->>'order_id' is not null and order_id=p_data->>'order_id') or (p_data->>'charge_id' is not null and charge_id=p_data->>'charge_id');
   return case when found then to_jsonb(c) else null end;
 elsif p_action='result' then
   select * into c from pitacco_private.pagbank_sandbox_pix where id=cid for update;
   if not found then raise exception 'charge not found'; end if;
   if c.order_id is not null and c.order_id is distinct from p_data->>'order_id' then raise exception 'order mismatch'; end if;
   if c.charge_id is not null and c.charge_id is distinct from p_data->>'charge_id' then raise exception 'charge mismatch'; end if;
   if c.status in ('PAID','REFUNDED') and p_data->>'status' not in ('PAID','REFUNDED') then return to_jsonb(c); end if;
   if c.status='REFUNDED' then return to_jsonb(c); end if;
   update pitacco_private.pagbank_sandbox_pix set status=p_data->>'status',order_id=coalesce(p_data->>'order_id',order_id),charge_id=coalesce(p_data->>'charge_id',charge_id),qr_text=coalesce(p_data->>'qr_text',qr_text),qr_id=coalesce(p_data->>'qr_id',qr_id),updated_at=now() where id=cid returning * into c;
   return to_jsonb(c);
 end if;
 raise exception 'invalid action';
end $$;
revoke all on function public.pitacco_pagbank_sandbox(text,jsonb) from public,anon,authenticated;
grant execute on function public.pitacco_pagbank_sandbox(text,jsonb) to service_role;