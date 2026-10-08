#!/usr/bin/env python3
"""Re-run C00 archive and document inventory checks; semantic review is separate."""
from pathlib import Path
import hashlib
import json
import re
import ast
r=Path(__file__).resolve().parents[1]
entries=json.loads((r/'archive/2026-10-08/manifest.json').read_text())
assert len(entries)==22
for e in entries:
    assert hashlib.sha256((r/e['archived']).read_bytes()).hexdigest()==e['sha256'], e['original']
print('PASS: 22 archived files match original hashes')
expected={'requirements.md','architecture.md','workflow.md','plan.md'}
ledger=json.loads((r/'checkpoints.json').read_text())
expected |= {str(Path(n).relative_to('docs')) for n in ledger.get('additional_active_docs',[]) if n.startswith('docs/')}
assert {str(p.relative_to(r/'docs')) for p in (r/'docs').rglob('*.md')}==expected
assert not (r/'spec').exists()
assert set(re.findall(r'^## (R\d\d)',(r/'docs/requirements.md').read_text(),re.M))=={f'R{i:02}' for i in range(1,10)}
assert set(re.findall(r'^## (C\d\d)',(r/'docs/plan.md').read_text(),re.M))=={f'C{i:02}' for i in range(8)}
for name in ['README.md','AGENTS.md',*[f'docs/{n}' for n in sorted(expected)]]:
    p=r/name; text=p.read_text()
    assert text.count('```')%2==0,name
    for target in re.findall(r'\]\(([^)]+)\)',re.sub(r'```.*?```','',text,flags=re.S)):
        if '://' in target or target.startswith('#'): continue
        q=(p.parent/target.split('#')[0]).resolve()
        assert q.exists(),(name,target)
        assert q.is_relative_to(r.resolve()) and 'archive' not in q.relative_to(r.resolve()).parts,(name,target)
print(f'PASS: {len(expected)+2} active documents, R01-R09, C00-C07, local links and fences')
for name in ['tools/check_project.py','tools/audit_c00.py']:
    ast.parse((r/name).read_text())
print('PASS: validator and audit Python syntax')
print('LIMIT: this audit does not prove game correctness, semantic completeness, or honest execution')
