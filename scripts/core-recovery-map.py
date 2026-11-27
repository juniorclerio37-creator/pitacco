#!/usr/bin/env python3
"""Map schema parity discrepancies to candidate SQL files already in Git.
This is a discovery tool, not a migration generator. No database access."""
import argparse
import json
from pathlib import Path
import re

def ident(s):
    return r'(?:"' + re.escape(s) + r'"|' + re.escape(s) + r')(?![\w$])'

def qualified(schema, name):
    return r'(?:(?:' + ident(schema) + r')\s*\.\s*)?' + ident(name)

def pattern(kind, key):
    parts = key.split('|')
    schema, name = parts[:2]
    if kind == 'relations':
        object_type = {'r':'table', 'p':'table', 'S':'sequence', 'v':'view', 'm':'materialized\s+view'}[parts[2]]
        return rf'\bcreate\s+(?:or\s+replace\s+)?(?:unlogged\s+)?{object_type}\s+(?:if\s+not\s+exists\s+)?{qualified(schema,name)}'
    if kind == 'routines':
        return rf'\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure|aggregate)\s+{qualified(schema,name)}\s*\('
    if kind == 'policies':
        return rf'\b(?:create|alter)\s+policy\s+{ident(parts[2])}\s+on\s+{qualified(schema,name)}'
    if kind == 'triggers':
        return rf'\bcreate\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+{ident(parts[2])}'
    raise ValueError(kind)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('parity', type=Path)
    parser.add_argument('--output', type=Path, default=Path('core-recovery-map.json'))
    args = parser.parse_args()
    parity = json.loads(args.parity.read_text(encoding='utf-8'))
    roots = ['supabase/migrations', 'core-source/web/supabase', 'core-source/android/supabase', 'setup']
    sources = {}
    for root in roots:
        for path in sorted(Path(root).rglob('*.sql')):
            if 'tests' not in path.parts and not path.name.endswith('.test.sql'):
                sources[path.as_posix()] = path.read_text(encoding='utf-8-sig')
    report = {}
    for kind, section in parity['objects'].items():
        objects = []
        for state, keys in [('missing', section['missing']), ('changed',[o['key'] for o in section['changed']])]:
            for key in keys:
                rx = re.compile(pattern(kind,key),re.IGNORECASE)
                candidates = []
                for path, sql in sources.items():
                    hit = rx.search(sql)
                    if hit:
                        candidates.append({'path':path,'line':sql.count('\n',0,hit.start())+1})
                objects.append({'state':state,'key':key,'candidates':candidates})
        report[kind] = {'objects':objects,'candidate_found':sum(bool(o['candidates']) for o in objects),
                        'candidate_not_found':sum(not o['candidates'] for o in objects)}
    result={'warning':'Textual candidates only; not semantic equivalence. Never replay on production. Implicit sequences and overloads require manual inspection.', 'files_scanned':len(sources),'objects':report}
    args.output.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'files_scanned':len(sources),**{k:{'candidate_found':v['candidate_found'],'candidate_not_found':v['candidate_not_found']} for k,v in report.items()}},indent=2))

if __name__ == '__main__':
    main()
