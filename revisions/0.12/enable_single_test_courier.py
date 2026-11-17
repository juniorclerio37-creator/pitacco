"""Expose the one verified test-store courier association in all dispatch interfaces.
Do not change ordinary courier membership, credentials or the global dispatch policy.
"""
from pathlib import Path

operations = Path("web/Operations.jsx")
s = operations.read_text(encoding="utf-8")
old = "client.from('couriers').select('id,name').eq('store_id',storeId)"
assert s.count(old)==1, "Operations courier roster query changed"
s=s.replace(old,"client.rpc('pitacco_store_couriers',{p_store:storeId})")
operations.write_text(s,encoding="utf-8")

dialog = Path("web/DeliveryDialog.jsx")
s=dialog.read_text(encoding="utf-8")
old="client.from('couriers').select('*').eq('store_id',storeId).eq('active',true)"
assert s.count(old)==1, "DeliveryDialog courier roster query changed"
s=s.replace(old,"client.rpc('pitacco_store_couriers',{p_store:storeId})")
dialog.write_text(s,encoding="utf-8")

hub = Path("web/LogisticsHub.jsx")
s=hub.read_text(encoding="utf-8")
old="client.from('couriers').select('*').eq('store_id',store.id).order('name')"
assert s.count(old)==1, "LogisticsHub courier roster query changed"
s=s.replace(old,"client.rpc('pitacco_store_couriers',{p_store:store.id})")
hub.write_text(s,encoding="utf-8")

workspace=Path("web/CourierWorkspace.jsx")
s=workspace.read_text(encoding="utf-8")
old="client.from('couriers').select('*').eq('store_id',store.id)"
assert s.count(old)==1,"CourierWorkspace courier roster query changed"
s=s.replace(old,"client.rpc('pitacco_store_couriers',{p_store:store.id})")
workspace.write_text(s,encoding="utf-8")

print("Single approved test courier is now available in Windows, browser, dispatch dialog and courier workspace.")
