insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('pitacco-installers','pitacco-installers',false,52428800,array['application/octet-stream'])
on conflict(id) do nothing;

create table public.pitacco_app_releases (
 id uuid primary key default gen_random_uuid(),
 app text not null check(app in ('windows','android')),
 channel text not null check(channel in ('stable','test')),
 version text not null check(version ~ '^[0-9]{1,6}[.][0-9]{1,6}[.][0-9]{1,6}(-[0-9A-Za-z-]{1,24}([.][0-9A-Za-z-]{1,24})*)?$' and length(version)<=64),
 filename text not null check(filename ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,118}[.](exe|msi|apk)$'),
 notes text not null default '' check(length(notes)<=3000),
 requirements text not null default '' check(length(requirements)<=1000),
 recommended boolean not null default false,
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 size_bytes integer not null check(size_bytes between 1 and 52428800),
 state text not null default 'draft' check(state in ('draft','published','withdrawn')),
 created_at timestamptz not null default now(),
 verified_at timestamptz,
 published_at timestamptz,
 unique(app,channel,version),
 check((app='windows' and filename ~ '[.](exe|msi)$') or (app='android' and filename ~ '[.]apk$')),
 check(channel<>'stable' or position('-' in version)=0)
);
create unique index pitacco_release_current_channel on public.pitacco_app_releases(app,channel) where state='published';

create table public.pitacco_app_release_audit (
 id bigint generated always as identity primary key,
 release_id uuid not null references public.pitacco_app_releases(id),
 actor uuid not null,
 action text not null check(action in ('draft','verified','published','withdrawn','replaced')),
 created_at timestamptz not null default now()
);

alter table public.pitacco_app_releases enable row level security;
alter table public.pitacco_app_release_audit enable row level security;
revoke all on public.pitacco_app_releases,public.pitacco_app_release_audit from public,anon,authenticated;
revoke all on sequence public.pitacco_app_release_audit_id_seq from public,anon,authenticated;
grant select on public.pitacco_app_releases,public.pitacco_app_release_audit to authenticated;

create policy pitacco_releases_read on public.pitacco_app_releases for select to authenticated using (
 (select public.pitacco_is_platform_owner())
 or (
   state='published' and channel='stable'
   and exists (select 1 from public.store_members m where m.user_id=(select auth.uid()) and m.role in ('gestor','lojista'))
 )
);
create policy pitacco_release_audit_read on public.pitacco_app_release_audit for select to authenticated
 using ((select public.pitacco_is_platform_owner()));

create policy pitacco_installers_upload on storage.objects for insert to authenticated with check (
 bucket_id='pitacco-installers' and (select public.pitacco_is_platform_owner())
 and exists(select 1 from public.pitacco_app_releases r where name=r.id::text||'/'||r.filename and r.state='draft' and r.verified_at is null)
);
create policy pitacco_installers_read on storage.objects for select to authenticated using (
 bucket_id='pitacco-installers'
 and exists(select 1 from public.pitacco_app_releases r where name=r.id::text||'/'||r.filename)
);

create function public.pitacco_create_release(
 p_app text,p_channel text,p_version text,p_filename text,p_notes text,p_requirements text,p_recommended boolean,p_sha256 text,p_size integer
) returns uuid language plpgsql security definer set search_path='' as $$
declare release_id uuid;
begin
 if not public.pitacco_is_platform_owner() then raise exception 'Acesso exclusivo do proprietário' using errcode='42501'; end if;
 insert into public.pitacco_app_releases(app,channel,version,filename,notes,requirements,recommended,sha256,size_bytes)
 values(p_app,p_channel,p_version,p_filename,p_notes,p_requirements,p_recommended,p_sha256,p_size)
 returning id into release_id;
 insert into public.pitacco_app_release_audit(release_id,actor,action) values(release_id,(select auth.uid()),'draft');
 return release_id;
end $$;

create function public.pitacco_record_release_integrity(p_id uuid,p_actor uuid,p_sha256 text,p_size integer)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from pitacco_private.platform_owner where user_id=p_actor) then
  raise exception 'Acesso exclusivo do proprietário' using errcode='42501';
 end if;
 update public.pitacco_app_releases set verified_at=now()
  where id=p_id and state='draft' and verified_at is null and sha256=p_sha256 and size_bytes=p_size
   and exists (select 1 from storage.objects where bucket_id='pitacco-installers' and name=p_id::text||'/'||filename);
 if not found then return false; end if;
 insert into public.pitacco_app_release_audit(release_id,actor,action) values(p_id,p_actor,'verified');
 return true;
end $$;

create function public.pitacco_release_transition(p_id uuid,p_action text,p_reviewed boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare target public.pitacco_app_releases%rowtype;
declare actor uuid := (select auth.uid());
begin
 if not public.pitacco_is_platform_owner() then raise exception 'Acesso exclusivo do proprietário' using errcode='42501'; end if;
 select * into strict target from public.pitacco_app_releases where id=p_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pitacco-release:'||target.app||':'||target.channel,0));
 select * into strict target from public.pitacco_app_releases where id=p_id for update;
 if p_action='publish' and target.state in ('draft','withdrawn') then
  if p_reviewed is distinct from true or target.verified_at is null
     or not exists(select 1 from storage.objects where bucket_id='pitacco-installers' and name=target.id::text||'/'||target.filename) then
   raise exception 'Valide o arquivo e confirme a revisão de segurança antes de publicar' using errcode='22023';
  end if;
  with retired as (
   update public.pitacco_app_releases set state='withdrawn'
    where app=target.app and channel=target.channel and state='published' returning id
  )
  insert into public.pitacco_app_release_audit(release_id,actor,action) select id,actor,'replaced' from retired;
  update public.pitacco_app_releases set state='published',published_at=now() where id=p_id;
  insert into public.pitacco_app_release_audit(release_id,actor,action) values(p_id,actor,'published');
 elsif p_action='withdraw' and target.state='published' then
  update public.pitacco_app_releases set state='withdrawn' where id=p_id;
  insert into public.pitacco_app_release_audit(release_id,actor,action) values(p_id,actor,'withdrawn');
 else
  raise exception 'Transição indisponível para esta versão' using errcode='22023';
 end if;
end $$;

revoke all on function public.pitacco_create_release(text,text,text,text,text,text,boolean,text,integer),
 public.pitacco_release_transition(uuid,text,boolean),public.pitacco_record_release_integrity(uuid,uuid,text,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.pitacco_create_release(text,text,text,text,text,text,boolean,text,integer),
 public.pitacco_release_transition(uuid,text,boolean) to authenticated;
grant execute on function public.pitacco_record_release_integrity(uuid,uuid,text,integer) to service_role;
