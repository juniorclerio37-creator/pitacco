"""Restore preserved 0.11 source and apply incremental, readable revisions."""
import base64,hashlib,pathlib,zipfile,io,shutil
encoded=''.join(p.read_text() for p in sorted(pathlib.Path('source').glob('*.b64')))
data=base64.b64decode(encoded,validate=True)
assert hashlib.sha256(data).hexdigest()=='bd8ad5b51edb6106d6f1b2a9cdecc916950411899a0c5311ce4be37d732ce504'
with zipfile.ZipFile(io.BytesIO(data)) as z:z.extractall('restored')
root=pathlib.Path('restored/Pitacco-v0.11')
for name in ['web','android','docs']:shutil.copytree(root/name,name,dirs_exist_ok=True)
shutil.copytree('updates/0.11.1/web','web',dirs_exist_ok=True)
for name in ['web','android','docs']:shutil.copytree(pathlib.Path('revisions/0.12')/name,name,dirs_exist_ok=True)
for file in ['package.json','package-lock.json','src-tauri/tauri.conf.json','src-tauri/Cargo.toml','src-tauri/Cargo.lock']:
 p=pathlib.Path('web')/file;text=p.read_text()
 if file.endswith('Cargo.lock'):
  for previous in ['0.11.0','0.11.1']:text=text.replace('name = "deliverygestor-desktop"\nversion = "'+previous+'"','name = "deliverygestor-desktop"\nversion = "0.12.0"')
 else:
  for previous in ['0.11.0','0.11.1']:text=text.replace(previous,'0.12.0')
 p.write_text(text)

# Apply the Windows spooler buffer fix after all source overlays.
import subprocess,sys
subprocess.run([sys.executable,'revisions/0.12/fix_printer_122.py'],check=True)

subprocess.run([sys.executable,'revisions/0.12/add_printer_ui_013.py'],check=True)

subprocess.run([sys.executable,'revisions/0.12/add_test_print_013.py'],check=True)

subprocess.run([sys.executable,'revisions/0.12/sync_receipt_templates_013.py'],check=True)

subprocess.run([sys.executable,'revisions/0.12/add_advanced_print_013.py'],check=True)

subprocess.run([sys.executable,'revisions/0.12/add_fideliza_016.py'],check=True)

subprocess.run([sys.executable,'revisions/0.12/reorganize_navigation_017.py'],check=True)
subprocess.run([sys.executable,'revisions/0.12/add_customers_034.py'],check=True)

subprocess.run([sys.executable,'revisions/0.12/improve_subscription_018.py'],check=True)

subprocess.run([sys.executable,'revisions/0.12/add_menu_studio_019.py'],check=True)

subprocess.run([sys.executable,'revisions/0.12/add_store_profile_020.py'],check=True)

subprocess.run([sys.executable,'revisions/0.12/add_theme_021.py'],check=True)

subprocess.run([sys.executable,'revisions/0.12/add_whatsapp_022.py'],check=True)

subprocess.run([sys.executable,'revisions/0.12/apply_approved_receipt_027.py'],check=True)

subprocess.run([sys.executable,'revisions/0.12/add_courier_finance_029.py'],check=True)
subprocess.run([sys.executable,'revisions/0.12/receipt_visibility_030.py'],check=True)

subprocess.run([sys.executable,'revisions/0.12/printer_experience_031.py'],check=True)

subprocess.run([sys.executable,'revisions/0.12/print_device_controls_033.py'],check=True)

# Pitacco 0.13: visual layout of four approved workspaces; preserves business logic.
subprocess.run([sys.executable,'revisions/0.12/apply_four_workspaces_035.py'],check=True)

# Owner-only release center, after navigation and theme overlays.
subprocess.run([sys.executable,'revisions/0.12/add_release_center_036.py'],check=True)

# Native update-check feedback, no unsigned installer execution.
subprocess.run([sys.executable,'revisions/0.12/add_update_check_037.py'],check=True)

# Separate admin and store workspaces, shared Windows executable.
subprocess.run([sys.executable,'revisions/0.12/separate_admin_shell_038.py'],check=True)

# Unified tenant workspaces and human-readable order references.
subprocess.run([sys.executable,'revisions/0.12/polish_store_workspaces_039.py'],check=True)

# Printer failure does not take down the orders feed.
subprocess.run([sys.executable,'revisions/0.12/isolate_print_sync_040.py'],check=True)

# Store logo overlay is deferred until its target is stable; do not block builds.

# Apply the unified store visual hierarchy after all business logic overlays.
subprocess.run([sys.executable,'revisions/0.12/layout_unificado_042.py'],check=True)

# Rebuild workspace structure after legacy overlays, keeping operational components.
# Temporarily disable rebuild_workspaces_043.py: Windows #176 blanks after startup; investigate before re-enabling.

# Notify with bell + voice only for orders arriving after initial synchronization.
subprocess.run([sys.executable,'revisions/0.12/new_order_voice_044.py'],check=True)

# Mount new orders UI with real backend callbacks and isolated styling.
subprocess.run([sys.executable,'revisions/0.12/mount_orders_045.py'],check=True)

# Apply uploaded four-screen design language to live components without demo data.
subprocess.run([sys.executable,'revisions/0.12/adapt_supplied_layout_046.py'],check=True)

# Real courier search and printer sector editing, using existing database tables.
subprocess.run([sys.executable,'revisions/0.12/functional_courier_printer_047.py'],check=True)

# Mount advanced courier rate settings and persisted HTML receipt editor.
subprocess.run([sys.executable,'revisions/0.12/advanced_rates_html_048.py'],check=True)

# Consolidated courier workspace: real data and existing backend operations.
subprocess.run([sys.executable,'revisions/0.12/mount_courier_workspace_049.py'],check=True)

# Windows only: orders, kitchen and printing. Full administration stays on the website.
subprocess.run([sys.executable,'revisions/0.12/windows_orders_only_050.py'],check=True)

# Hosted dashboards use the official public Supabase project and show email/password login.
subprocess.run([sys.executable,'revisions/0.12/hosted_login_051.py'],check=True)

# Explain email confirmation accurately and guide existing accounts to login.
subprocess.run([sys.executable,'revisions/0.12/auth_signup_feedback_052.py'],check=True)

# Compact orange navigation for mobile web; keep desktop and all workflows.
subprocess.run([sys.executable,'revisions/0.12/mobile_orange_nav_053.py'],check=True)

# Compile platform administration as a separate website, outside the store bundle.
subprocess.run([sys.executable,'revisions/0.12/separate_public_portals.py'],check=True)

subprocess.run([sys.executable,'revisions/0.12/merchant_reference_layout.py'],check=True)

subprocess.run([sys.executable,'revisions/0.12/mount_storefront_settings.py'],check=True)

subprocess.run([sys.executable,'revisions/0.12/ifood_merchant_orders.py'],check=True)

# Modern order intake and a Windows-native chime; preserve the print subsystem.
subprocess.run([sys.executable,'revisions/0.12/windows_order_intake.py'],check=True)

# Final merchant navigation change: keep assistance in its own page and dispatch in Deliveries.
subprocess.run([sys.executable,'revisions/0.12/finalize_merchant_navigation.py'],check=True)

# New storefront design studio only on web, preserving desktop order/print workflow.
subprocess.run([sys.executable,'revisions/0.12/mount_store_design_studio.py'],check=True)

# First-run wizard and server-backed diagnostics; never modifies existing orders.
subprocess.run([sys.executable,'revisions/0.12/mount_launch_wizard.py'],check=True)

# Printer tests remain native-only; website uses explicit browser print dialog.
subprocess.run([sys.executable,'revisions/0.12/finalize_web_manual_print.py'],check=True)

# Confirm printer paper only in Windows; never convert spooler submission to print success.
subprocess.run([sys.executable,'revisions/0.12/add_windows_paper_confirmation.py'],check=True)

# Opening hours: web-only merchant configuration, independent of scheduled-order slots.
subprocess.run([sys.executable,'revisions/0.12/mount_store_opening_hours.py'],check=True)
# Windows keeps every authorized management module and restores the Brendi-style thermal preview.
subprocess.run([sys.executable,'revisions/0.12/enable_windows_modules_preview.py'],check=True)
# Keep Windows operations alive while other modules navigate; show build version and print access.
subprocess.run([sys.executable,'revisions/0.12/windows_navigation_diagnostics_0123.py'],check=True)
# Test-only delivery association in both web and Windows app.
subprocess.run([sys.executable,'revisions/0.12/enable_single_test_courier.py'],check=True)
# Respect iFood's ready vs terminal events; never mark courier delivered from kitchen preparation.
subprocess.run([sys.executable,'revisions/0.12/ifood_not_completed_on_ready.py'],check=True)
# Keep the repaired automatic print queue and reprint feedback visible in the Windows app.
subprocess.run([sys.executable,'revisions/0.12/windows_print_feedback_0126.py'],check=True)
# Natural locally cached studio/neural voice, imported once by the merchant; existing approved bell unchanged.
subprocess.run([sys.executable,'revisions/0.12/windows_natural_voice_0127.py'],check=True)
# Restore reliable merchant Windows alert and offer settings on orders/configuration screens.
subprocess.run([sys.executable,'revisions/0.12/fix_windows_merchant_alert_0128.py'],check=True)
# Embed the sole approved merchant voice and 5 bells into the signed Windows executable.
subprocess.run([sys.executable,'revisions/0.12/embed_merchant_audio_0129.py'],check=True)
# Move all sound controls to Configurações; keep Pedidos focused on cards.
subprocess.run([sys.executable,'revisions/0.12/clean_windows_order_screen_0130.py'],check=True)
# Native Windows order monitor works even when the WebView is minimized.
subprocess.run([sys.executable,'revisions/0.12/native_background_order_alert_0131.py'],check=True)
for relative in ['package.json','package-lock.json','src-tauri/tauri.conf.json','src-tauri/Cargo.toml','src-tauri/Cargo.lock']:
 p=pathlib.Path('web')/relative
 value=p.read_text(encoding='utf-8')
 if relative.endswith('Cargo.lock'):
  value=value.replace('name = "deliverygestor-desktop"\nversion = "0.12.0"', 'name = "deliverygestor-desktop"\nversion = "0.12.22"')
 else:
  value=value.replace('"0.12.0"', '"0.12.22"')
 p.write_text(value,encoding='utf-8')

# Menu importador web: qualquer loja com permissão pode importar sem afetar o app Windows.
subprocess.run([sys.executable,'revisions/0.12/mount_universal_menu_import.py'],check=True)

# Show the new version number in the existing Windows status/diagnostics UI.
ui=pathlib.Path('web/src.jsx')
content=ui.read_text(encoding='utf-8')
if 'Pitacco Windows v0.12.10' in content:
 ui.write_text(content.replace('Pitacco Windows v0.12.10','Pitacco Windows v0.12.22'),encoding='utf-8')

# Shared delivery geometry is advisory in the UI; the server still validates every quote.
shutil.copyfile("supabase/functions/delivery-quote/coverage-geometry.mjs","web/deliveryCoverageGeometry.mjs")

# Approved thermal artwork and font sizes, using the existing spooler queue.
subprocess.run([sys.executable,'revisions/0.12/graphical_receipt_0132.py'],check=True)

# Restore the manager-only Fiado workspace after navigation overlays.
subprocess.run([sys.executable,'revisions/0.12/restore_fiado_navigation.py'],check=True)
