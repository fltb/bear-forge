import {test} from 'node:test';
import assert from 'node:assert/strict';
import {test262Cases,test262ExcludedFeatures,hasUnsupportedImportAttributes,verifyTest262Checkout} from '../test262-cases.ts';
import {runTest262ProductionResolution} from '../test262-production-resolution.ts';

test('pinned Test262 module resolution failures retain their phase and error constructor',async t=>{
  const root=process.env.TEST262_ROOT;
  assert.ok(root,'Set TEST262_ROOT to a complete clean checkout of the pinned Test262 revision');
  await verifyTest262Checkout(root);
  const counts={selected:0,passed:0,failed:0,notExecuted:0,excludedByDeclaredFeature:0,excludedByUnsupportedAttributes:0};
  const unresolved:{file:string;outcome:string;detail:string}[]=[];
  for await(const candidate of test262Cases(root)){
    if(candidate.mode!=='module'||candidate.negative?.phase!=='resolution')continue;
    counts.selected++;
    if(candidate.features.some(feature=>test262ExcludedFeatures.has(feature))){counts.excludedByDeclaredFeature++;continue;}
    if(hasUnsupportedImportAttributes(candidate.source)){counts.excludedByUnsupportedAttributes++;continue;}
    const result=await runTest262ProductionResolution(candidate,root);
    if(result.status==='passed')counts.passed++;
    else{
      if(result.status==='failed')counts.failed++;else counts.notExecuted++;
      unresolved.push({file:result.file,outcome:result.outcome,detail:result.detail});
    }
  }
  t.diagnostic(JSON.stringify({backend:'production-module-resolution',counts,unresolved}));
  assert.ok(counts.selected>0,'No module resolution-negative cases selected');
  assert.equal(counts.selected,counts.passed+counts.failed+counts.notExecuted+counts.excludedByDeclaredFeature+counts.excludedByUnsupportedAttributes);
  assert.equal(counts.failed,0,'A native-link result disagreed with the required Test262 phase or constructor');
  assert.equal(counts.notExecuted,0,'An in-scope module resolution case was not executed');
});
