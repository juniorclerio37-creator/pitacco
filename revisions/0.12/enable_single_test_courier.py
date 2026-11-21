"""Keep the existing courier roster RPC across restored merchant UIs.

The restore pipeline overlays already-modernized components before running
this historical fix. If the RPC is present, do not reapply the patch.
This does NOT alter a courier's home store, credentials or push scope.
"""
from pathlib import Path

def ensure_rpc(path, old, updated, label):
    file = Path(path)
    content = file.read_text(encoding="utf-8")
    if content.count(updated) == 1:
        # The restored revision is already patched.
        assert content.count(old) == 0, f"{label}: duplicate old and new roster paths"
        return
    assert content.count(old) == 1, f"{label}: courier roster source unexpected"
    file.write_text(content.replace(old, updated), encoding="utf-8")

ensure_rpc("web/Operations.jsx",
 "client.from('couriers').select('id,name').eq('store_id',storeId)",
 "client.rpc('pitacco_store_couriers',{p_store:storeId})",
 "Operations")
ensure_rpc("web/DeliveryDialog.jsx",
 "client.from('couriers').select('*').eq('store_id',storeId).eq('active',true)",
 "client.rpc('pitacco_store_couriers',{p_store:storeId})",
 "DeliveryDialog")
ensure_rpc("web/LogisticsHub.jsx",
 "client.from('couriers').select('*').eq('store_id',store.id).order('name')",
 "client.rpc('pitacco_store_couriers',{p_store:store.id})",
 "LogisticsHub")
ensure_rpc("web/CourierWorkspace.jsx",
 "client.from('couriers').select('*').eq('store_id',store.id)",
 "client.rpc('pitacco_store_couriers',{p_store:store.id})",
 "CourierWorkspace")
print("Courier roster RPC is present across dispatch and merchant screens.")
