"""Install the pinned map runtime in both desktop and hosted builds.
No runtime CDN script or stylesheet; lock metadata comes from npm Leaflet 1.9.4.
"""
import json
from pathlib import Path
p=Path('web/package.json')
pkg=json.loads(p.read_text(encoding='utf-8'))
pkg.setdefault('dependencies',{})['leaflet']='1.9.4'
p.write_text(json.dumps(pkg,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
p=Path('web/package-lock.json')
lock=json.loads(p.read_text(encoding='utf-8'))
assert lock.get('lockfileVersion',0)>=2 and '' in lock['packages']
lock['packages'][''].setdefault('dependencies',{})['leaflet']='1.9.4'
lock['packages']['node_modules/leaflet']={
 'version':'1.9.4','resolved':'https://registry.npmjs.org/leaflet/-/leaflet-1.9.4.tgz',
 'integrity':'sha512-nxS1ynzJOmOlHp+iL3FyWqK89GtNL8U8rvlMOsQdTTssxZwCXh8N2NB3GDQOL+YR3XnWyZAxwQixURb+FA74PA==',
 'license':'BSD-2-Clause'
}
if lock.get('lockfileVersion')==2:
 lock.setdefault('dependencies',{})['leaflet']={k:v for k,v in lock['packages']['node_modules/leaflet'].items() if k!='license'}
p.write_text(json.dumps(lock,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
