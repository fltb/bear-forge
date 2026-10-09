"""Verify preserved rules, public declarations, capability paths and final check evidence."""
from pathlib import Path
import hashlib,json,re
old=json.loads(Path('evidence/C01/migration-baseline/old-report.json').read_text())
def previous(path):return next(x['sha256'] for x in old['artifacts'] if x['path']==path)
for path in ['games/doudizhu/src/patterns.ts','tests/doudizhu/oracle.ts','tests/doudizhu/rules.test.ts']:
 assert previous(path)==hashlib.sha256(Path(path).read_bytes()).hexdigest(),path
 print('PASS unchanged domain/oracle baseline:',path)
# Only the reviewed timing boundary edits are allowed in the original rule implementation.
rules=Path('games/doudizhu/src/rules.ts').read_text()
normalized=rules.replace("input: Exclude<Input,{kind:'clock'}>","input: Input").replace('s.now >= slot.deadline!.atGameTime','input.receivedAtGameTime < s.now || input.receivedAtGameTime >= slot.deadline!.atGameTime').replace('at: s.now','at: input.receivedAtGameTime')
normalized=normalized.replace("  if(input.kind==='clock'){\n    if(!Number.isSafeInteger(input.at)||input.at<s.now)throw new RuleViolation('clock moved backwards');\n    s.now=input.at;return;\n  }\n",'')
assert previous('games/doudizhu/src/rules.ts')==hashlib.sha256(normalized.encode()).hexdigest()
print('PASS original rules unchanged after normalizing the explicit session-clock migration')
report=Path('evidence/C01/boundary-migration-review.md').read_text()
for path in Path('packages/contracts/src').rglob('*.ts'):
 if path.name!='index.ts':assert '```ts\n'+path.read_text()+'```' in report,str(path)
print('PASS declaration appendix reproduces every current contract and internal type file')
index=json.loads(Path('evidence/C01/protocol-proof-index.json').read_text());names={x['name'] for x in index['definitions']}
assert {'Core','Instance','BaseGame','Request','Accepted','GameModule','GameSDK','SessionControl','InstanceCapture','InstancePersistence','Branching'}<=names
assert not names&{'Choice','DecisionOffer','GameRequest','GameInput','DecisionPolicy','GameRunStop','GameRunLimits','InstanceRunLimits','GameHistory','StateTransition','FactExtraction','GameUpdate'}
print('PASS simplified interfaces and optional capability entrypoints replace old public surfaces')
log=Path('evidence/C01/boundary-migration-check.log').read_text()
for expected in ['tests 75','pass 75','fail 0','skipped 0','41 public/game schemas','68 public definitions']:
 assert expected in log,expected
print('PASS final full check: 75 tests, 41 admitted schemas, 68 definitions across capability subpaths')
print('SCOPE C01 public protocols, author game and executable native consumers; C02/C03 production providers')
