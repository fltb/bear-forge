#!/usr/bin/env python3
"""Check documentation/checkpoint integrity, not game correctness or evidence honesty."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[1]
ACTIVE = {'README.md', 'AGENTS.md', 'docs/requirements.md', 'docs/architecture.md',
          'docs/workflow.md', 'docs/plan.md'}

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def validate(root):
    errors = []
    def require(condition, message):
        if not condition:
            errors.append(message)
    def local(name):
        p = (root / name).resolve()
        if not p.is_relative_to(root.resolve()):
            raise ValueError('path escapes project: ' + name)
        return p
    try:
        actual = {str(p.relative_to(root)) for p in root.rglob('*.md')
                  if p.relative_to(root).parts[0] not in {'archive', 'evidence'}
                  and 'node_modules' not in p.parts and '.git' not in p.parts}
        state = json.loads((root / 'checkpoints.json').read_text())
        active = ACTIVE | set(state.get('additional_active_docs', []))
        require(actual == active, 'active document allowlist mismatch')
        for name in active:
            p = local(name)
            require(not name.startswith('archive/'), 'archive cannot be active')
            if not p.exists():
                errors.append('missing active document: ' + name)
                continue
            s = p.read_text()
            require(s.count('```') % 2 == 0, 'unclosed code fence: ' + name)
            plain = re.sub(r'```.*?```', '', s, flags=re.S)
            for link in re.findall(r'\]\(([^)]+)\)', plain):
                if '://' in link or link.startswith('#'):
                    continue
                target = (p.parent / link.split('#')[0]).resolve()
                require(target.exists(), 'broken link: ' + name + ' -> ' + link)
                require(target.is_relative_to(root.resolve()), 'link escapes project: ' + link)
                require('archive' not in target.relative_to(root.resolve()).parts,
                        'active document references archive: ' + name)
        manifest = json.loads((root / 'archive/2026-10-08/manifest.json').read_text())
        require(len(manifest) == 22, 'archive count mismatch')
        for entry in manifest:
            p = local(entry['archived'])
            require(p.is_file() and sha(p) == entry['sha256'], 'archive changed: ' + entry['archived'])
        plan = (root / 'docs/plan.md').read_text()
        matches = re.findall(r'^- \[([ x])\] `(C\d\d-\d\d)`', plan, re.M)
        require(len(matches) == len({i for _, i in matches}), 'duplicate checklist id')
        boxes = {i: mark == 'x' for mark, i in matches}
        cps = state['checkpoints']
        require(list(cps) == ['C%02d' % i for i in range(8)], 'checkpoint sequence mismatch')
        all_items = {}
        running = []
        for index, (cid, cp) in enumerate(cps.items()):
            status = cp['status']
            require(status in {'pending', 'in_progress', 'blocked', 'done'}, 'invalid status: ' + cid)
            expected_deps = [] if index == 0 else ['C%02d' % (index-1)]
            require(cp['depends_on'] == expected_deps, 'dependency changed: ' + cid)
            if status != 'pending':
                require(all(cps[d]['status'] == 'done' for d in expected_deps), 'dependency not done: ' + cid)
            if status == 'in_progress':
                running.append(cid)
            require(bool(cp['next_action']), 'missing next_action: ' + cid)
            if status == 'blocked':
                require(bool(cp.get('blocker')), 'missing blocker: ' + cid)
            for item, value in cp['items'].items():
                require(item.startswith(cid + '-'), 'wrong checkpoint item: ' + item)
                require(value in {'pending', 'passed'}, 'invalid item state: ' + item)
                require(item in boxes and boxes[item] == (value == 'passed'), 'checklist mismatch: ' + item)
                all_items[item] = value
            if status == 'pending':
                require(all(v == 'pending' for v in cp['items'].values()), 'pending checkpoint has passed items: ' + cid)
            if status == 'done':
                require(all(v == 'passed' for v in cp['items'].values()), 'done with incomplete items: ' + cid)
            if status == 'done' or any(v == 'passed' for v in cp['items'].values()):
                report_path = cp.get('evidence')
                require(bool(report_path), 'missing evidence: ' + cid)
                if not report_path:
                    continue
                report = json.loads(local(report_path).read_text())
                require(report['checkpoint'] == cid, 'evidence checkpoint mismatch: ' + cid)
                kind = 'documentation' if cid == 'C00' else 'design' if cid == 'C01' else 'implementation'
                require(report['kind'] == kind, 'evidence kind mismatch: ' + cid)
                require(bool(report.get('summary')), 'missing evidence summary: ' + cid)
                require(bool(report['artifacts']), 'empty artifacts: ' + cid)
                for artifact in report['artifacts']:
                    p = local(artifact['path'])
                    require(p.is_file() and sha(p) == artifact['sha256'], 'stale artifact: ' + artifact['path'])
                checks = report['checks']
                require(len(checks) == len({c['id'] for c in checks}), 'duplicate evidence check: ' + cid)
                lookup = {c['id']: c for c in checks}
                for item, value in cp['items'].items():
                    if value != 'passed':
                        continue
                    c = lookup.get(item, {})
                    require(c.get('status') == 'passed' and c.get('exit_code') == 0
                            and bool(c.get('command')), 'invalid check evidence: ' + item)
                    log = c.get('log')
                    require(bool(log) and local(log).is_file() and local(log).stat().st_size > 0,
                            'missing check log: ' + item)
                if cid != 'C00':
                    require((root / 'evidence' / cid / 'acceptance.md').is_file(), 'missing acceptance: ' + cid)
                    require(bool(report.get('replay_command')), 'missing replay command: ' + cid)
        require(set(boxes) == set(all_items), 'plan/ledger item set mismatch')
        require(len(running) <= 1, 'multiple in_progress checkpoints')
        current = state['current_checkpoint']
        require(current in cps, 'invalid current checkpoint')
        if running:
            require(running == [current], 'current checkpoint is not running checkpoint')
        first_open = next((i for i, c in cps.items() if c['status'] != 'done'), None)
        require(state.get('next_checkpoint') == first_open, 'next checkpoint skips unfinished work')
    except (OSError, ValueError, KeyError, TypeError) as e:
        errors.append('invalid/missing project data: ' + str(e))
    return errors

def self_test(root):
    tests = [
        ('missing evidence', lambda r, s: s['checkpoints']['C00'].update(evidence=None)),
        ('skip dependency', lambda r, s: s['checkpoints']['C02'].update(status='in_progress')),
        ('unchecked completion', lambda r, s: s['checkpoints']['C00']['items'].update({'C00-01':'pending'})),
        ('multiple active', lambda r, s: [s['checkpoints'][i].update(status='in_progress') for i in ['C01','C02']]),
        ('archive link', lambda r, s: (r/'README.md').write_text((r/'README.md').read_text()+'\n[old](archive/README.md)\n')),
        ('changed artifact', lambda r, s: (r/'docs/requirements.md').write_text('changed\n')),
        ('unregistered doc', lambda r, s: (r/'docs/extra.md').write_text('extra\n')),
        ('missing log', lambda r, s: (r/'evidence/C00/archive.log').unlink()),
    ]
    initial = validate(root)
    if initial:
        return ['self-test requires a valid baseline: ' + '; '.join(initial)]
    failures = []
    for label, mutate in tests:
        with tempfile.TemporaryDirectory() as d:
            temp = Path(d)/'project'
            shutil.copytree(root, temp, ignore=shutil.ignore_patterns('node_modules','.git','__pycache__'))
            state = json.loads((temp/'checkpoints.json').read_text())
            mutate(temp,state)
            (temp/'checkpoints.json').write_text(json.dumps(state))
            rejected = bool(validate(temp))
            print(('PASS' if rejected else 'FAIL') + ': reject ' + label)
            if not rejected:
                failures.append(label)
    return failures

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    errors = self_test(ROOT) if args.self_test else validate(ROOT)
    for error in errors:
        print('FAIL: ' + error)
    if not errors:
        print('PASS: ' + ('8 negative cases rejected' if args.self_test else 'document, checklist, archive and evidence integrity'))
    raise SystemExit(1 if errors else 0)
