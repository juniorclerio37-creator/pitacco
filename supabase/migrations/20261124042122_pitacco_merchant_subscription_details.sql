create or replace function public.pitacco_merchant_subscription_details(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão para consultar assinatura' using errcode='42501'; end if;
 select public.pitacco_store_subscription_status(s.id)||jsonb_build_object(
  'plan_code',s.plan,'registered_monthly_amount',sub.monthly_amount,'due_date',sub.due_date,
  'payments',coalesce((select jsonb_agg(to_jsonb(x) order by x.confirmed_at desc) from
   (select provider,amount,confirmed_at,paid_until from pitacco_private.subscription_payments
    where store_id=s.id order by confirmed_at desc limit 100) x),'[]'::jsonb)
 ) into result from public.stores s left join public.subscriptions sub on sub.store_id=s.id where s.id=p_store;
 if result is null then raise exception 'Loja não encontrada';end if;
 return result;
end $$;
revoke all on function public.pitacco_merchant_subscription_details(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_merchant_subscription_details(uuid) to authenticated;
notify pgrst,'reload schema';