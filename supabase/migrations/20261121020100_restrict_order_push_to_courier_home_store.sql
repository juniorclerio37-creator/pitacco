-- Loud assignment notification is restricted to the courier's HOME store.
-- A legacy cross-store test authorization must not be used to route sounds.
do $$
declare f text;source text;
begin
 select pg_get_functiondef('pitacco_private.enqueue_courier_push()'::regprocedure) into source;
 if position('(c.store_id=new.store_id or public.pitacco_courier_test_access(c.id,new.store_id))' in source)=0
 then raise exception 'Assignment enqueue function changed unexpectedly'; end if;
 f:=replace(source,
  '(c.store_id=new.store_id or public.pitacco_courier_test_access(c.id,new.store_id))',
  '(c.store_id=new.store_id)');
 execute f;

 select pg_get_functiondef('public.pitacco_claim_courier_push()'::regprocedure) into source;
 if position('(c.store_id=d.store_id or public.pitacco_courier_test_access(c.id,d.store_id))' in source)=0
 then raise exception 'Assignment dispatch function changed unexpectedly'; end if;
 f:=replace(source,
  '(c.store_id=d.store_id or public.pitacco_courier_test_access(c.id,d.store_id))',
  '(c.store_id=d.store_id)');
 execute f;
end $$;