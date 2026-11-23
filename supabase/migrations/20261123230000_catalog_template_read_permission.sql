-- SELECT usa wrapper público autorizado, não a função privada sem EXECUTE de authenticated.
drop policy if exists pitacco_complement_template_select on public.pitacco_complement_templates;
create policy pitacco_complement_template_select on public.pitacco_complement_templates
 for select to authenticated using (public.pitacco_menu_import_allowed(store_id));
