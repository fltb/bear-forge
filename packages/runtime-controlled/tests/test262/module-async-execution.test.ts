import {test} from 'node:test';
import assert from 'node:assert/strict';
import {test262Cases,test262ExcludedFeatures,hasUnsupportedDynamicImport,
  hasUnsupportedImportAttributes,verifyTest262Checkout} from '../../../compiler/tests/test262-cases.ts';
import {runTest262Module} from '../test262-module.ts';

test('pinned positive async modules complete through the production controlled Program',async t=>{
  const root=process.env.TEST262_ROOT;
  assert.ok(root,'Set TEST262_ROOT to a complete clean checkout of the pinned Test262 revision');
  await verifyTest262Checkout(root);
  const shadowRealmAvailable=typeof Reflect.get(globalThis,'ShadowRealm')==='function';
  const counts={selected:0,excludedByDeclaredFeature:0,excludedByUnsupportedAttributes:0,
    excludedByDynamicImportSyntax:0,targetV8MissingShadowRealm:0,inScope:0,passed:0,failed:0,notExecuted:0};
  const unresolved:{file:string;kind:string;constructorName?:string}[]=[];
  for await(const candidate of test262Cases(root)){
    if(candidate.mode!=='module'||candidate.negative!==null||!candidate.asynchronous)continue;
    counts.selected++;
    if(candidate.features.some(feature=>test262ExcludedFeatures.has(feature))){counts.excludedByDeclaredFeature++;continue;}
    if(hasUnsupportedImportAttributes(candidate.source)){counts.excludedByUnsupportedAttributes++;continue;}
    if(hasUnsupportedDynamicImport(candidate.source)){counts.excludedByDynamicImportSyntax++;continue;}
    if(!shadowRealmAvailable&&candidate.features.includes('ShadowRealm')){
      counts.targetV8MissingShadowRealm++;continue;
    }
    counts.inScope++;
    const result=await runTest262Module(candidate,root);
    if(result.status==='passed')counts.passed++;
    else{
      if(result.status==='failed')counts.failed++;else counts.notExecuted++;
      unresolved.push({file:candidate.file,kind:result.execution.kind,
        ...(result.execution.kind==='threw'?{constructorName:result.execution.constructorName}:{})});
    }
  }
  t.diagnostic(JSON.stringify({backend:'production-controlled-positive-async',counts,unresolved}));
  assert.equal(counts.selected,101,'Pinned async module selection changed');
  assert.equal(counts.selected,counts.excludedByDeclaredFeature+counts.excludedByUnsupportedAttributes+
    counts.excludedByDynamicImportSyntax+counts.targetV8MissingShadowRealm+counts.inScope,
    'Every async module must have a declared-scope classification');
  assert.ok(counts.passed>=38,'Production async execution coverage regressed');
  assert.ok(counts.excludedByDynamicImportSyntax<=4,'New untagged dynamic imports need review');
  assert.ok(counts.targetV8MissingShadowRealm<=4,'New target-V8 capability gaps need review');
  assert.equal(counts.inScope,counts.passed+counts.failed+counts.notExecuted);
  assert.equal(counts.failed+counts.notExecuted,0,'In-scope async modules must complete through original $DONE');
});
