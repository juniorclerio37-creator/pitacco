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
