
do $patch$
declare f text;
begin
 select pg_get_functiondef('pitacco_private.group_auto_one(uuid)'::regprocedure) into f;
 f:=replace(f,'b.completed_at is null and a.status in (''atribuida'',''aceita'')),true)','b.completed_at is null and a.status in (''atribuida'',''aceita'')) filter (where a.id is not null),true)');
 execute f;
 select pg_get_functiondef('public.dg_assign_route(uuid,uuid,boolean,boolean)'::regprocedure) into f;
 f:=replace(f,'or coalesce(auth.jwt()->>''role'','''') = ''service_role''','or coalesce(auth.jwt()->>''role'','''') = ''service_role'' or (automatic and auth.uid() is null)');
 execute f;
end $patch$;
revoke all on function public.dg_assign_route(uuid,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.dg_assign_route(uuid,uuid,boolean,boolean) to service_role;

