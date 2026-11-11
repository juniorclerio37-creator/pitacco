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
