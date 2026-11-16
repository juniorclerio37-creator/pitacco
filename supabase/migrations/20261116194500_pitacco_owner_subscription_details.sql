-- Leitura administrativa das assinaturas; não altera cobrança, contratos ou permissões.
create or replace function public.pitacco_owner_subscription_details()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Acesso exclusivo do proprietário';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'name',s.name,'phone',s.phone,'created_at',s.created_at,
    'status',state.status,'trial_ends_at',state.trial_ends_at,
    'paid_until',state.paid_until,'plan','Pitacco Padrão',
    'monthly_amount',coalesce(sub.monthly_amount,59.90),
    'due_date',sub.due_date,'subscription_status',sub.status,
    'orders_count',(select count(*) from public.orders o where o.store_id=s.id),
    'last_order_at',(select max(o.created_at) from public.orders o where o.store_id=s.id),
    'payments',coalesce((select jsonb_agg(jsonb_build_object(
      'provider',p.provider,'amount',p.amount,'confirmed_at',p.confirmed_at,
      'paid_until',p.paid_until,'payment_id',p.provider_payment_id
    ) order by p.confirmed_at desc) from pitacco_private.subscription_payments p where p.store_id=s.id),'[]'::jsonb)
  ) order by s.name),'[]'::jsonb) into result
  from public.stores s
  cross join lateral pitacco_private.subscription_state(s.id) state
  left join public.subscriptions sub on sub.store_id=s.id;
  return result;
end;
$$;
revoke all on function public.pitacco_owner_subscription_details() from public,anon;
grant execute on function public.pitacco_owner_subscription_details() to authenticated;
