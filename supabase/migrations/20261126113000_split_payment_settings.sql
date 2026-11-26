-- Split publication and payment updates so saving one panel never overwrites the other.
create or replace function public.pitacco_save_storefront_publication(p_store uuid,p_enabled boolean,p_delivery_enabled boolean,p_pickup_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $save$
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_enabled is null or p_delivery_enabled is null or p_pickup_enabled is null or not(p_delivery_enabled or p_pickup_enabled) then raise exception 'Selecione entrega ou retirada';end if;
 update public.public_menu_settings set enabled=p_enabled,delivery_enabled=p_delivery_enabled,pickup_enabled=p_pickup_enabled where store_id=p_store;
 if not found then raise exception 'Cardápio indisponível';end if;
 insert into public.operation_audit(store_id,actor,action,details) values(p_store,auth.uid(),'storefront_publication_saved',jsonb_build_object('enabled',p_enabled,'delivery_enabled',p_delivery_enabled,'pickup_enabled',p_pickup_enabled));
 return jsonb_build_object('saved',true,'enabled',p_enabled,'delivery_enabled',p_delivery_enabled,'pickup_enabled',p_pickup_enabled);
end $save$;
revoke all on function public.pitacco_save_storefront_publication(uuid,boolean,boolean,boolean) from public,anon,authenticated;
grant execute on function public.pitacco_save_storefront_publication(uuid,boolean,boolean,boolean) to authenticated;
create or replace function public.pitacco_save_payment_methods_only(p_store uuid,p_public text[],p_pdv text[],p_pix_instructions text)
returns jsonb language plpgsql security definer set search_path='' as $save$
declare allowed text[]:=array['dinheiro','cartao_entrega','cartao_credito','cartao_debito','pix_manual','pix_maquininha','voucher_alelo','voucher_pluxee','voucher_vr','voucher_ticket']; methods text[]; clean text;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_public is null or p_pdv is null then raise exception 'Selecione as formas de pagamento';end if;
 if cardinality(p_public) not between 1 and 10 or cardinality(p_pdv) not between 1 and 10 or not p_public <@ allowed or not p_pdv <@ allowed or array_position(p_public,null) is not null or array_position(p_pdv,null) is not null or (select count(distinct x) from unnest(p_public)x)<>cardinality(p_public) or (select count(distinct x) from unnest(p_pdv)x)<>cardinality(p_pdv) then raise exception 'Formas de pagamento inválidas';end if;
 clean:=coalesce(public.dg_clean_text(p_pix_instructions),'');
 if length(coalesce(p_pix_instructions,''))>1000 or (('pix_manual'=any(p_public) or 'pix_manual'=any(p_pdv)) and length(trim(clean))<3) then raise exception 'Informe instruções válidas para o Pix manual';end if;
 update public.public_menu_settings set payment_methods=p_public,pdv_payment_methods=p_pdv,pix_instructions=clean where store_id=p_store;
 if not found then raise exception 'Cardápio indisponível';end if;
 insert into public.operation_audit(store_id,actor,action,details) values(p_store,auth.uid(),'payment_methods_saved',jsonb_build_object('public',p_public,'pdv',p_pdv));
 return jsonb_build_object('saved',true,'payment_methods',p_public,'pdv_payment_methods',p_pdv,'pix_instructions',clean);
end $save$;
revoke all on function public.pitacco_save_payment_methods_only(uuid,text[],text[],text) from public,anon,authenticated;
grant execute on function public.pitacco_save_payment_methods_only(uuid,text[],text[],text) to authenticated;
notify pgrst,'reload schema';
