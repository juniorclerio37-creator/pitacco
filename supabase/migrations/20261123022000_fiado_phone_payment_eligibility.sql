-- Opção Fiado aparece automaticamente entre os meios de pagamento apenas
-- para telefones autorizados pela loja. Nunca expor nomes, limite ou dívidas
-- do cliente nesta consulta pública. O CHECKOUT mantém exigência do PIN
-- particular e validação transacional de crédito.
create or replace function public.pitacco_fiado_phone_eligibility(
  p_slug text, p_phone text
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $fiado$
declare
  sid uuid;
  v_phone text := regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  allowed boolean := false;
begin
  if v_phone !~ '^[0-9]{10,11}$' then
    return jsonb_build_object('eligible',false);
  end if;

  select m.store_id into sid
  from public.public_menu_settings m
  join public.pitacco_fiado_settings f
    on f.store_id=m.store_id and f.enabled
  where m.slug=p_slug and m.enabled
  limit 1;

  if sid is null then
    return jsonb_build_object('eligible',false);
  end if;

  select exists(
    select 1 from public.pitacco_fiado_customers c
    where c.store_id=sid and c.phone=v_phone
      and c.enabled
      and c.credential_hash is not null
      and c.credit_limit>c.used
      and (c.credential_locked_until is null or c.credential_locked_until<=now())
      and not (
        c.block_overdue and exists (
          select 1 from public.pitacco_fiado_charges d
          where d.store_id=sid and d.customer_id=c.id
            and d.state='open' and d.amount>d.paid and d.due_at<now()
        )
      )
  ) into allowed;

  return jsonb_build_object('eligible',coalesce(allowed,false));
end
$fiado$;

revoke all on function public.pitacco_fiado_phone_eligibility(text,text)
  from public,anon,authenticated;
grant execute on function public.pitacco_fiado_phone_eligibility(text,text)
  to anon,authenticated;
