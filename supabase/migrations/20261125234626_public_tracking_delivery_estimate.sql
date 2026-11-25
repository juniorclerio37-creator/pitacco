do $patch$ declare f text;begin
select pg_get_functiondef('public.pitacco_track_public_order(uuid)'::regprocedure) into f;
if position('''delivery_eta'',case' in f)=0 then
 f:=replace(f,'''payment_method'',o.receipt->>''payment''','''payment_method'',o.receipt->>''payment'',''delivery_eta'',case when o.source=''proprio'' then jsonb_build_object(''earliest_at'',o.receipt#>>''{delivery_eta,earliest_at}'',''latest_at'',o.receipt#>>''{delivery_eta,latest_at}'') end');
 execute f;
end if;
end $patch$;
