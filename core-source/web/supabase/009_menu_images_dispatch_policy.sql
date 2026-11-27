-- Apply after 008. Multi-tenant staging images, dispatch settings and safe server-side assignments.
alter table public.menu_import_staging add column if not exists image_source text;
alter table public.menu_import_staging add column if not exists image_path text;
alter table public.stores add column if not exists dispatch_mode text not null default 'manual' check(dispatch_mode in ('manual','automatico','misto'));
alter table public.stores add column if not exists max_orders_per_trip integer not null default 1 check(max_orders_per_trip between 1 and 15);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('menu-import-images','menu-import-images',false,5242880,array['image/png','image/jpeg','image/webp']) on conflict(id) do nothing;
create policy "menu_images_read" on storage.objects for select to authenticated using(bucket_id='menu-import-images' and exists(select 1 from public.stores s where s.id::text=split_part(name,'/',1) and public.is_store_manager(s.id)));
create policy "menu_images_insert" on storage.objects for insert to authenticated with check(bucket_id='menu-import-images' and exists(select 1 from public.stores s where s.id::text=split_part(name,'/',1) and public.is_store_manager(s.id)));
create or replace function public.set_dispatch_policy(s uuid, dispatch text, max_orders integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_store_manager(s) or dispatch not in ('manual','automatico','misto') or max_orders not between 1 and 15 then raise exception 'Configuração inválida';end if;
 update public.stores set dispatch_mode=dispatch,max_orders_per_trip=max_orders where id=s;
end$$;
-- One-order automatic assignment. Chooses least-busy authorized courier; no route optimization claimed.
create or replace function public.auto_assign_delivery(s uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare did uuid; cid uuid; fleetmode text; dispatch text;
begin
 if not public.is_store_manager(s) then raise exception 'Sem permissão';end if;
 select delivery_mode,dispatch_mode into fleetmode,dispatch from public.stores where id=s;
 if dispatch not in ('automatico','misto') then raise exception 'Modo automático desabilitado';end if;
 select id into did from public.deliveries where store_id=s and status='pendente' and courier_id is null and coalesce(logistics_provider,'')<>'marketplace' order by created_at,id for update skip locked limit 1;
 if did is null then raise exception 'Nenhuma entrega pendente';end if;
 select c.id into cid from public.couriers c
 where c.active and ((c.fleet_type='propria' and c.store_id=s and fleetmode in ('propria','ambas')) or (c.fleet_type='compartilhada' and fleetmode in ('compartilhada','ambas') and public.is_admin()))
 and public.can_manage_courier(c.id,s)
 and not exists(select 1 from public.deliveries d where d.courier_id=c.id and d.status in ('atribuida','aceita','retirada'))
 order by c.created_at,c.id limit 1;
 if cid is null then raise exception 'Nenhum entregador livre autorizado';end if;
 update public.deliveries set courier_id=cid,status='atribuida',updated_at=now() where id=did;
 return did;
end$$;
-- Append only to a batch owned by same store, same courier, respecting max trip size.
create or replace function public.append_delivery_to_batch(s uuid, delivery_id uuid, p_batch_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare b public.delivery_batches%rowtype; cap integer; current_count integer;
begin
 if not public.is_store_manager(s) then raise exception 'Sem permissão';end if;
 select * into b from public.delivery_batches where id=p_batch_id and store_id=s for update;
 if not found then raise exception 'Viagem inexistente';end if;
 select max_orders_per_trip into cap from public.stores where id=s;
 perform 1 from public.deliveries where id=delivery_id and store_id=s and status='pendente' and courier_id is null and batch_id is null and coalesce(logistics_provider,'')<>'marketplace' for update;
 if not found then raise exception 'Pedido não está disponível';end if;
 select count(*) into current_count from public.deliveries where deliveries.batch_id=p_batch_id and status not in ('entregue','cancelada');
 if current_count>=cap then raise exception 'Limite de pedidos por viagem atingido';end if;
 if exists(select 1 from public.deliveries where deliveries.batch_id=p_batch_id and status in ('retirada','entregue')) then raise exception 'Viagem já iniciada';end if;
 update public.deliveries set courier_id=b.courier_id,batch_id=b.id,status='atribuida',updated_at=now() where id=delivery_id;
end$$;
-- Replace batch assignment with limit enforcement (same checks as 006).
create or replace function public.assign_delivery_batch(s uuid, courier uuid, delivery_ids uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare batch uuid; expected_count integer; matching_count integer; fleet text; mode text; cap integer;
begin
 if not public.is_store_manager(s) then raise exception 'Sem permissão';end if;
 expected_count:=coalesce(array_length(delivery_ids,1),0);
 select delivery_mode,max_orders_per_trip into mode,cap from public.stores where id=s;
 if expected_count<2 or expected_count>cap then raise exception 'Quantidade excede limite da viagem';end if;
 if (select count(distinct x) from unnest(delivery_ids) x)<>expected_count then raise exception 'Pedidos repetidos';end if;
 select fleet_type into fleet from public.couriers where id=courier and active;
 if fleet is null or not public.can_manage_courier(courier,s) or (fleet='propria' and mode not in ('propria','ambas')) or (fleet='compartilhada' and mode not in ('compartilhada','ambas')) then raise exception 'Entregador não autorizado';end if;
 perform 1 from public.deliveries where id=any(delivery_ids) for update;
 select count(*) into matching_count from public.deliveries where id=any(delivery_ids) and store_id=s and status='pendente' and courier_id is null and batch_id is null and coalesce(logistics_provider,'')<>'marketplace';
 if matching_count<>expected_count then raise exception 'Pedidos indisponíveis';end if;
 insert into public.delivery_batches(store_id,courier_id,created_by) values(s,courier,auth.uid()) returning id into batch;
 update public.deliveries set courier_id=courier,status='atribuida',batch_id=batch,updated_at=now() where id=any(delivery_ids);
 return batch;
end$$;
revoke all on function public.set_dispatch_policy(uuid,text,integer),public.auto_assign_delivery(uuid),public.append_delivery_to_batch(uuid,uuid,uuid) from public;
grant execute on function public.set_dispatch_policy(uuid,text,integer),public.auto_assign_delivery(uuid),public.append_delivery_to_batch(uuid,uuid,uuid) to authenticated;
