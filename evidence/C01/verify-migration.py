"""Verify current migration artifacts; protocol semantics are argued in the report."""
from pathlib import Path
import hashlib
import json
import re

old=json.loads(Path('evidence/C01/migration-baseline/old-report.json').read_text())
for path in ['games/doudizhu/src/rules.ts','games/doudizhu/src/patterns.ts','tests/doudizhu/oracle.ts','tests/doudizhu/rules.test.ts']:
    previous=next(item for item in old['artifacts'] if item['path']==path)
    assert previous['sha256']==hashlib.sha256(Path(path).read_bytes()).hexdigest()
    print('PASS unchanged rule baseline:',path)
report=Path('evidence/C01/boundary-migration-review.md').read_text()
for path in Path('packages/contracts/src').rglob('*.ts'):
    if path.name!='index.ts':
        assert '```ts\n'+path.read_text()+'```' in report,str(path)
print('PASS every public declaration file reproduced exactly in the field report')
index=json.loads(Path('evidence/C01/protocol-proof-index.json').read_text())
names={item['name'] for item in index['definitions']}
assert not names&{'GameUpdate','Execution','ExecutionPersistence','GameRuntime','GameContext','InputOptionsCapability','InputValidationCapability','ManagedStateCapability','CompiledGame','GameQueries','GamePersistence','GameSimulation','GameExtensions','LoadedGame','Branching','GameSnapshot','GameReadTarget','GameId','ServiceModule','BaseGameFactory'}
assert {'Core','Instance','BaseGame','GameModule','IO','PortBindings','StateTransition','GameContract','GameSDK','PortBindings','CallbackReply','InstanceRunStop','GameBindings','GameRunStop','DecisionPolicy','EventDelivery','NativeCoreLoader','ControlledCoreLoader'}<=names
print('PASS old boundaries removed and replacement capabilities exported')
for path in [*Path('games/doudizhu/src').glob('*.ts'),*Path('packages/contracts/src').rglob('*.ts')]:
    assert not re.search(r'\b(?:bindDouDizhu|Execution|GameRuntime|GameContext|ManagedStateCapability)\b',path.read_text()),path
print('PASS no compatibility entrypoints in active source')
log=Path('evidence/C01/boundary-migration-check.log').read_text()
for expected in ['tests 57','pass 57','fail 0','skipped 0','44 public/game schemas','100 public definitions']:
    assert expected in log,expected
print('PASS final full check counts and no skipped tests')
print('SCOPE declarations + complete native game author source; production runtime and Instance fork/save/restore implementation remain future conformance obligations')
