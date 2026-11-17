-- The public login page may see and download only the current stable courier APK.
create function public.pitacco_public_courier_apk()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('path',id::text||'/'||filename,'filename',filename,'version',version)
 from public.pitacco_app_releases
 where app='android' and channel='stable' and state='published' and verified_at is not null
$$;
revoke all on function public.pitacco_public_courier_apk() from public,anon,authenticated;
grant execute on function public.pitacco_public_courier_apk() to anon,authenticated;

create policy pitacco_installers_courier_public on storage.objects for select to anon,authenticated
 using (bucket_id='pitacco-installers' and name=(select public.pitacco_public_courier_apk()->>'path'));
