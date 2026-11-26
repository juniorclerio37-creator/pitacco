do $patch$
declare f text;
begin
 select pg_get_functiondef('public.pitacco_register_store(text,text)'::regprocedure) into f;
 if strpos(f,'on conflict(store_id) do nothing;')=0 then raise exception 'Signup conflict anchor missing';end if;
 execute replace(f,'on conflict(store_id) do nothing;','on conflict on constraint store_registration_pkey do nothing;');
end $patch$;
notify pgrst,'reload schema';
