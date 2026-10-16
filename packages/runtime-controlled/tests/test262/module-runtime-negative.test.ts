import {test} from 'node:test';
import assert from 'node:assert/strict';
import {test262Cases,test262ExcludedFeatures,hasUnsupportedImportAttributes,verifyTest262Checkout} from '../../../compiler/tests/test262-cases.ts';
import {runTest262Module} from '../test262-module.ts';

test('pinned runtime-negative modules throw in production with the required constructor',async t=>{
  const root=process.env.TEST262_ROOT;
  assert.ok(root,'Set TEST262_ROOT to a complete clean checkout of the pinned Test262 revision');
  await verifyTest262Checkout(root);
  const counts={selected:0,excludedByDeclaredFeature:0,excludedByUnsupportedAttributes:0,inScope:0,passed:0,failed:0,notExecuted:0};
  const unresolved:{file:string;kind:string;phase?:string;constructorName?:string}[]=[];
  for await(const candidate of test262Cases(root)){
    if(candidate.mode!=='module'||candidate.negative?.phase!=='runtime')continue;
    counts.selected++;
    if(candidate.features.some(feature=>test262ExcludedFeatures.has(feature))){counts.excludedByDeclaredFeature++;continue;}
    if(hasUnsupportedImportAttributes(candidate.source)){counts.excludedByUnsupportedAttributes++;continue;}
    counts.inScope++;
    const result=await runTest262Module(candidate,root);
    if(result.status==='passed')counts.passed++;
    else{
      if(result.status==='failed')counts.failed++;else counts.notExecuted++;
      unresolved.push({file:candidate.file,kind:result.execution.kind,
        ...(result.execution.kind==='threw'?{phase:result.execution.phase,constructorName:result.execution.constructorName}:{}),
        ...(result.execution.kind==='admission-rejected'?{phase:result.execution.phase}:{})});
    }
  }
  t.diagnostic(JSON.stringify({backend:'production-controlled-runtime-negative',counts,unresolved}));
  assert.equal(counts.selected,counts.excludedByDeclaredFeature+counts.excludedByUnsupportedAttributes+counts.inScope);
  assert.ok(counts.passed>=7,'Production runtime-negative coverage regressed');
  assert.equal(counts.inScope,counts.passed+counts.failed+counts.notExecuted);
  assert.equal(counts.failed+counts.notExecuted,0,'A runtime-negative module did not throw its required error');
});
