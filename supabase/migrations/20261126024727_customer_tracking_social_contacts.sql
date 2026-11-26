
alter table public.stores add column if not exists instagram_url text, add column if not exists facebook_url text;
create function pitacco_private.store_social_url(p_value text,p_network text) returns text language plpgsql immutable set search_path='' as $$
declare v text:=btrim(coalesce(p_value,''));begin
 if v='' then return null;end if;
 if length(v)>180 or not ((p_network='instagram' and v ~* '^https://(www\.)?instagram\.com/[a-z0-9_.]+/?$') or (p_network='facebook' and v ~* '^https://(www\.)?facebook\.com/[a-z0-9._/-]+/?$')) then raise exception 'Informe o link HTTPS válido da rede social';end if;
 return v;
end $$;
revoke all on function pitacco_private.store_social_url(text,text) from public,anon,authenticated;
do $patch$ declare f text;begin
 select pg_get_functiondef('public.pitacco_store_registration(uuid)'::regprocedure) into f;
 if strpos(f,'''whatsapp'',s.phone')=0 then raise exception 'Registration read anchor missing';end if;
 execute replace(f,'''whatsapp'',s.phone','''whatsapp'',s.phone,''instagram_url'',s.instagram_url,''facebook_url'',s.facebook_url');
 select pg_get_functiondef('public.pitacco_save_store_registration(uuid,jsonb)'::regprocedure) into f;
 if strpos(f,'return jsonb_build_object(''saved'',true);')=0 then raise exception 'Registration save anchor missing';end if;
 execute replace(f,'return jsonb_build_object(''saved'',true);','update public.stores set instagram_url=case when p_data ? ''instagram_url'' then pitacco_private.store_social_url(p_data->>''instagram_url'',''instagram'') else instagram_url end,facebook_url=case when p_data ? ''facebook_url'' then pitacco_private.store_social_url(p_data->>''facebook_url'',''facebook'') else facebook_url end where id=p_store;return jsonb_build_object(''saved'',true);');
 select pg_get_functiondef('public.get_public_menu(text)'::regprocedure) into f;
 if strpos(f,'''whatsapp'',(select phone from public.stores where id=cfg.store_id)')=0 then raise exception 'Public menu anchor missing';end if;
 execute replace(f,'''whatsapp'',(select phone from public.stores where id=cfg.store_id)','''whatsapp'',(select phone from public.stores where id=cfg.store_id),''instagram_url'',(select instagram_url from public.stores where id=cfg.store_id),''facebook_url'',(select facebook_url from public.stores where id=cfg.store_id)');
 select pg_get_functiondef('public.pitacco_track_public_order(uuid)'::regprocedure) into f;
 if strpos(f,'''store'',jsonb_build_object(''name'',s.name')=0 then raise exception 'Tracking anchor missing';end if;
 execute replace(f,'''store'',jsonb_build_object(''name'',s.name','''customer_name'',left(coalesce(nullif(c.payload->>''customer'',''''),nullif(o.receipt->>''customer'','''')),120),''store'',jsonb_build_object(''name'',s.name,''whatsapp'',s.phone');
end $patch$;
create or replace function pitacco_private.public_delivery_position(p_store uuid,p_order uuid)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('state',case when context.grouped then 'multiple_stops' when context.fresh then 'available' else 'awaiting_gps' end)
 || case when context.grouped then jsonb_build_object('another_arrived',context.another_arrived and delivery.arrived_at is null) else '{}'::jsonb end
 || case when context.fresh then jsonb_build_object('latitude',round(gps.latitude::numeric,case when context.grouped then 2 else 3 end),'longitude',round(gps.longitude::numeric,case when context.grouped then 2 else 3 end),'observed_at',gps.observed_at,'approximate_radius_m',case when context.grouped then 1500 else 140 end) else '{}'::jsonb end
 || case when context.fresh then jsonb_build_object('shop',case when s.latitude between -90 and 90 and s.longitude between -180 and 180 then jsonb_build_object('latitude',s.latitude,'longitude',s.longitude) end,'destination',case when delivery.latitude between -90 and 90 and delivery.longitude between -180 and 180 then jsonb_build_object('latitude',delivery.latitude,'longitude',delivery.longitude) end) else '{}'::jsonb end
 from public.deliveries delivery
 join public.stores s on s.id=delivery.store_id
 join public.couriers courier on courier.id=delivery.courier_id and courier.active
 left join public.courier_positions gps on gps.courier_id=courier.id
 left join public.delivery_batches route on route.id=delivery.batch_id and route.store_id=delivery.store_id
 cross join lateral(select
 exists(select 1 from public.deliveries other where other.id<>delivery.id and other.status not in ('entregue','cancelada') and ((delivery.batch_id is not null and other.batch_id=delivery.batch_id) or (other.courier_id=delivery.courier_id and other.status='retirada'))) as grouped,
 exists(select 1 from public.deliveries other where other.id<>delivery.id and other.courier_id=delivery.courier_id and other.status='retirada' and other.arrived_at is not null) as another_arrived,
 coalesce(gps.observed_at between greatest(route.departed_at,delivery.collected_at,delivery.updated_at,now()-interval '90 seconds') and now() and gps.latitude between -90 and 90 and gps.longitude between -180 and 180,false) as fresh
 ) context
 where delivery.store_id=p_store and delivery.order_id=p_order and delivery.logistics_provider='loja' and delivery.status='retirada' and (delivery.batch_id is null or route.departed_at is not null)
 order by delivery.created_at desc limit 1
$$;
revoke all on function pitacco_private.public_delivery_position(uuid,uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
