"""Use the official public Supabase connection on hosted Pitacco dashboards.
Do not affect Windows desktop or developer/local installations.
"""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
needle="const {url,key}=connectionConfig(import.meta.env,storage);"
assert s.count(needle)==1, 'Supabase config location changed'
replacement="""const detectedConfig=connectionConfig(import.meta.env,storage);
const isHostedPitacco=typeof window!=='undefined' && !nativeAvailable() && ['app.pitacco.com.br','pitacco.com.br','www.pitacco.com.br'].includes(window.location.hostname.toLowerCase());
const url=isHostedPitacco?'https://mdevzehqcpcgxspwbiyz.supabase.co':detectedConfig.url;
const key=isHostedPitacco?'sb_publishable_JLIp1y5II26GrztrKDNIyQ_ryETrCuj':detectedConfig.key;"""
s=s.replace(needle,replacement,1)
p.write_text(s,encoding='utf-8')
