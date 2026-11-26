-- Public storefront identity: small, read-only projection of already-public menu fields.
CREATE OR REPLACE FUNCTION public.pitacco_public_menu_identity(p_slug text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
 SELECT jsonb_build_object(
  'name',s.name,'slug',m.slug,'whatsapp',s.phone,
  'instagram_url',s.instagram_url,'facebook_url',s.facebook_url,
  'profile_logo_path',to_jsonb(s)->>'logo_path','logo_url',b.logo_url,
  'primary_color',coalesce(b.primary_color,'#db482f')
 )
 FROM public.public_menu_settings m
 JOIN public.stores s ON s.id=m.store_id
 LEFT JOIN public.store_customer_branding b ON b.store_id=m.store_id
 WHERE m.slug=p_slug AND m.enabled
 LIMIT 1
$function$;
REVOKE ALL ON FUNCTION public.pitacco_public_menu_identity(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pitacco_public_menu_identity(text) TO anon, authenticated;
NOTIFY pgrst,'reload schema';
