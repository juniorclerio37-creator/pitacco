begin;
insert into auth.users(id,email) values
 ('ef000000-0000-4000-8000-000000000001','release-owner@example.invalid'),
 ('ef000000-0000-4000-8000-000000000002','release-store@example.invalid'),
 ('ef000000-0000-4000-8000-000000000003','release-outsider@example.invalid');
insert into pitacco_private.platform_owner(user_id,login_name_hash)
values ('ef000000-0000-4000-8000-000000000001',sha256(convert_to('00000000001','UTF8')));
insert into public.stores(id,name) values ('ef000000-0000-4000-8000-000000000004','Loja da fixture');
insert into public.store_members(store_id,user_id,role)
values('ef000000-0000-4000-8000-000000000004','ef000000-0000-4000-8000-000000000002','gestor') on conflict do nothing;
grant select,insert on storage.objects to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','ef000000-0000-4000-8000-000000000001',true);
do $$
declare package_id uuid;
begin
 package_id:=public.pitacco_create_release('windows','stable','1.0.0','Pitacco.exe','Notas','Windows',true,repeat('a',64),128);
 perform set_config('test.release_id',package_id::text,true);
 insert into storage.objects(bucket_id,name) values('pitacco-installers',package_id::text||'/Pitacco.exe');
 begin
  perform public.pitacco_release_transition(package_id,'publish',true);
  raise exception 'Unverified release published';
 exception when invalid_parameter_value then null;
 end;
end $$;

select set_config('request.jwt.claim.sub','ef000000-0000-4000-8000-000000000002',true);
do $$
declare package_id uuid := current_setting('test.release_id')::uuid;
begin
 if exists(select 1 from public.pitacco_app_releases where id=package_id) then raise exception 'Draft leaked'; end if;
 if exists(select 1 from storage.objects where bucket_id='pitacco-installers') then raise exception 'Draft installer leaked'; end if;
 begin
  perform public.pitacco_release_transition(package_id,'publish',true);
  raise exception 'Merchant can publish';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.pitacco_record_release_integrity(package_id,auth.uid(),repeat('a',64),128);
  raise exception 'Merchant can verify a release';
 exception when insufficient_privilege then null;
 end;
end $$;

set local role service_role;
do $$
declare package_id uuid := current_setting('test.release_id')::uuid;
 owner_id uuid := 'ef000000-0000-4000-8000-000000000001';
begin
 if public.pitacco_record_release_integrity(package_id,owner_id,repeat('b',64),128) then raise exception 'Wrong digest accepted'; end if;
 if not public.pitacco_record_release_integrity(package_id,owner_id,repeat('a',64),128) then raise exception 'Valid digest rejected'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','ef000000-0000-4000-8000-000000000001',true);
do $$
declare package_id uuid := current_setting('test.release_id')::uuid;
begin
 begin
  perform public.pitacco_release_transition(package_id,'publish',false);
  raise exception 'Unreviewed release published';
 exception when invalid_parameter_value then null;
 end;
 perform public.pitacco_release_transition(package_id,'publish',true);
end $$;

select set_config('request.jwt.claim.sub','ef000000-0000-4000-8000-000000000003',true);
do $$begin
 if exists(select 1 from public.pitacco_app_releases) then raise exception 'A user without a store sees downloads'; end if;
end $$;

select set_config('request.jwt.claim.sub','ef000000-0000-4000-8000-000000000002',true);
do $$begin
 if (select count(*) from public.pitacco_app_releases where state='published')<>1 then raise exception 'Published installer unavailable'; end if;
 if (select count(*) from storage.objects where bucket_id='pitacco-installers')<>1 then raise exception 'Published object unavailable'; end if;
 if exists(select 1 from public.pitacco_app_release_audit) then raise exception 'Audit leaked'; end if;
end $$;

select set_config('request.jwt.claim.sub','ef000000-0000-4000-8000-000000000001',true);
select public.pitacco_release_transition(current_setting('test.release_id')::uuid,'withdraw');
do $$begin
 if (select count(*) from public.pitacco_app_release_audit)<>4 then raise exception 'Incomplete release audit'; end if;
end $$;
select set_config('request.jwt.claim.sub','ef000000-0000-4000-8000-000000000002',true);
do $$begin
 if exists(select 1 from storage.objects where bucket_id='pitacco-installers') then raise exception 'Withdrawn installer visible'; end if;
end $$;
rollback;

begin;
insert into public.pitacco_app_releases(app,channel,version,filename,sha256,size_bytes,state,verified_at)
values ('android','stable','1.0.0','stable.apk',repeat('a',64),100,'published',now()),
 ('android','test','2.0.0','test.apk',repeat('b',64),100,'published',now()),
 ('android','stable','2.0.0','draft.apk',repeat('c',64),100,'draft',now()),
 ('windows','stable','1.0.0','stable.exe',repeat('d',64),100,'published',now());
insert into storage.objects(bucket_id,name)
select 'pitacco-installers',id::text||'/'||filename from public.pitacco_app_releases;
grant select on storage.objects to anon;
set local role anon;
do $$
begin
 if public.pitacco_public_courier_apk()->>'filename'<>'stable.apk' then
  raise exception 'Public download did not resolve to the stable Android release';
 end if;
 if (select count(*) from storage.objects where bucket_id='pitacco-installers')<>1 then
  raise exception 'Public storage exposed drafts, test versions or Windows installers';
 end if;
end $$;
reset role;
update public.pitacco_app_releases set state='withdrawn' where app='android' and channel='stable';
set local role anon;
do $$
begin
 if public.pitacco_public_courier_apk() is not null or exists(select 1 from storage.objects where bucket_id='pitacco-installers') then
  raise exception 'Withdrawn Android APK is still public';
 end if;
end $$;
rollback;
