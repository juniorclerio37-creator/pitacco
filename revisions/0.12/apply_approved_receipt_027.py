from pathlib import Path
p=Path('web/printBridge.mjs')
s=p.read_text(encoding='utf-8')
marker=" const html=typeof localStorage!=='undefined'&&job.store_id?localStorage.getItem('pitacco:receipt:'+job.store_id):null;"
assert s.count(marker)==1, 'print bridge template entry not found'
s="import {approvedReceipt} from './approvedReceipt.mjs';\n"+s
s=s.replace(marker,marker+"\n if(!html){const approved=approvedReceipt(job,Number(job.width)===58?58:80);if(approved)return approved;} ",1)
p.write_text(s,encoding='utf-8')
