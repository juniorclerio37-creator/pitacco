"""Use the official public Supabase connection on hosted Pitacco dashboards.
Use the official backend as the Windows default when no connection was configured.
"""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
needle="const {url,key}=connectionConfig(import.meta.env,storage);"
assert s.count(needle)==1, 'Supabase config location changed'
replacement="""const detectedConfig=connectionConfig(import.meta.env,storage);
const isHostedPitacco=import.meta.env.VITE_PITACCO_HOMOLOGACAO!=='1' && typeof window!=='undefined' && !nativeAvailable() && ['app.pitacco.com.br','pitacco.com.br','www.pitacco.com.br'].includes(window.location.hostname.toLowerCase());
const useOfficial=isHostedPitacco||(nativeAvailable()&&!detectedConfig.url&&import.meta.env.VITE_PITACCO_HOMOLOGACAO!=='1');
const url=useOfficial?'https://mdevzehqcpcgxspwbiyz.supabase.co':detectedConfig.url;
const key=useOfficial?'sb_publishable_JLIp1y5II26GrztrKDNIyQ_ryETrCuj':detectedConfig.key;"""
s=s.replace(needle,replacement,1)
p.write_text(s,encoding='utf-8')
