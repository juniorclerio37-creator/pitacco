create or replace function public.pitacco_owner_commercial_payment_claims(p_store uuid default null,p_status text default 'pending',p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $claims$
declare items jsonb; totals jsonb;
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_status is null or p_status not in ('all','pending','approved','rejected') or p_page is null or p_page not between 0 and 100000 then raise exception 'Filtro inválido' using errcode='22023';end if;
 select jsonb_build_object('pending',count(*) filter(where c.status='pending'),'approved',count(*) filter(where c.status='approved'),'rejected',count(*) filter(where c.status='rejected')) into totals
 from pitacco_private.commercial_payment_claims c join pitacco_private.commercial_invoices i on i.id=c.invoice_id
 join pitacco_private.commercial_closings b using(contract_id,kind,period_end) where p_store is null or b.store_id=p_store;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) into items from (
 select c.id,c.invoice_id,b.store_id,s.name as store_name,i.kind,i.amount_cents,i.due_at,c.reference,c.mime,c.status,c.created_at,c.reviewed_at,c.review_note
 from pitacco_private.commercial_payment_claims c join pitacco_private.commercial_invoices i on i.id=c.invoice_id
 join pitacco_private.commercial_closings b using(contract_id,kind,period_end) join public.stores s on s.id=b.store_id
 where (p_store is null or b.store_id=p_store) and (p_status='all' or c.status=p_status)
 order by c.created_at desc,c.id desc offset p_page*25 limit 26) x;
 return jsonb_build_object('rows',items-25,'has_more',jsonb_array_length(items)>25,'counts',totals);
end $claims$;
revoke all on function public.pitacco_owner_commercial_payment_claims(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.pitacco_owner_commercial_payment_claims(uuid,text,integer) to authenticated;
notify pgrst,'reload schema';
