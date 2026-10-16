import {test} from 'node:test';
import assert from 'node:assert/strict';
import {test262Cases, test262ExcludedFeatures, hasUnsupportedDynamicImport,
  hasUnsupportedImportAttributes, verifyTest262Checkout} from '../../../compiler/tests/test262-cases.ts';
import {runTest262Reference} from '../../../compiler/tests/test262-reference.ts';
import type {Test262Result} from '../../../compiler/tests/test262-outcome.ts';
import {runTest262Module} from '../test262-module.ts';
import {excludedAuthorFeatures} from '../../../compiler/tests/test262-scope.ts';

// This execution profile is narrower than the compiler's syntax/link profile:
// the target Node cannot instantiate source-phase JavaScript modules, while
// author-created Proxy objects have no controlled Context representation.
const executionUnavailableFeatures=new Set(['source-phase-imports','Proxy']);

test('pinned positive Test262 modules are classified before production execution',async t=>{
  const root=process.env.TEST262_ROOT;
  assert.ok(root,'Set TEST262_ROOT to a complete clean checkout of the pinned Test262 revision');
  await verifyTest262Checkout(root);
  assert.equal(typeof Reflect.get(globalThis,'AbstractModuleSource'),'undefined',
    'Revisit source-phase execution scope when the target Node adds AbstractModuleSource');
  const counts={moduleCases:0,negativeParse:0,negativeResolution:0,negativeRuntime:0,positiveAsync:0,selected:0,
    excludedByDeclaredFeature:0,excludedByUnsupportedAttributes:0,excludedByDynamicImportSyntax:0,excludedByExecutionFeature:0,
    admittedCandidates:0,authorAdmissionRejected:0,targetV8LinkRejected:0,inScope:0,inScopeWithHarness:0,
    passed:0,failed:0,notExecuted:0};
  const excluded:Record<string,number>={},outcomes:Record<string,number>={}, examples:Record<string,Test262Result[]>={};
  const byFeature:Record<string,Record<string,number>>={};
  const incomplete:{file:string;kind:string;constructorName?:string}[]=[];
  for await(const candidate of test262Cases(root)){
    if(candidate.mode!=='module')continue;
    counts.moduleCases++;
    if(candidate.negative!==null){
      if(candidate.negative.phase==='parse')counts.negativeParse++;
      else if(candidate.negative.phase==='resolution')counts.negativeResolution++;
      else counts.negativeRuntime++;
      continue;
    }
    if(candidate.asynchronous){counts.positiveAsync++;continue;}
    counts.selected++;
    const outside=candidate.features.filter(feature=>test262ExcludedFeatures.has(feature));
    if(outside.length){
      counts.excludedByDeclaredFeature++;
      for(const feature of outside)excluded[feature]=(excluded[feature]??0)+1;
      continue;
    }
    if(hasUnsupportedImportAttributes(candidate.source)){counts.excludedByUnsupportedAttributes++;continue;}
    if(hasUnsupportedDynamicImport(candidate.source)){counts.excludedByDynamicImportSyntax++;continue;}
    const unavailable=candidate.features.filter(feature=>executionUnavailableFeatures.has(feature));
    if(unavailable.length){
      counts.excludedByExecutionFeature++;
      for(const feature of unavailable)excluded[feature]=(excluded[feature]??0)+1;
      continue;
    }
    counts.admittedCandidates++;
    const result=await runTest262Module(candidate,root);
    outcomes[result.execution.kind]=(outcomes[result.execution.kind]??0)+1;
    for(const feature of candidate.features.length?candidate.features:['(no feature metadata)']){
      const group=byFeature[feature]??={};
      group[result.execution.kind]=(group[result.execution.kind]??0)+1;
    }
    if(result.execution.kind==='admission-rejected'&&result.execution.phase==='compile'){
      const excluded=await excludedAuthorFeatures(root,candidate);
      if(excluded.size){
        counts.authorAdmissionRejected++;
        incomplete.push({file:candidate.file,kind:'author-admission-rejected: '+[...excluded].join(', ')});
        continue;
      }
    }
    if(result.execution.kind==='runner-error'){
      const native=await runTest262Reference(candidate,5000,root);
      if(native.execution.kind==='threw'&&native.execution.phase==='resolution'&&native.execution.constructorName==='SyntaxError'){
        counts.targetV8LinkRejected++;
        incomplete.push({file:candidate.file,kind:'target-v8-link-rejected'});
        continue;
      }
    }
    counts.inScope++;
    if(candidate.harness.length)counts.inScopeWithHarness++;
    if(result.status==='passed')counts.passed++;
    else{
      incomplete.push({file:candidate.file,kind:result.execution.kind,
        ...(result.execution.kind==='threw'?{constructorName:result.execution.constructorName}:{})});
      if(result.status==='failed')counts.failed++;else counts.notExecuted++;
      const group=examples[result.execution.kind]??=[];
      if(group.length<4)group.push(result);
    }
  }
  t.diagnostic(JSON.stringify({backend:'production-controlled',profile:'declared-in-scope-positive-modules-without-async-flag',counts,excluded,outcomes,byFeature,incomplete,examples}));
  assert.equal(counts.moduleCases,counts.negativeParse+counts.negativeResolution+counts.negativeRuntime+counts.positiveAsync+counts.selected,'Every module must have an execution-profile classification');
  assert.ok(counts.selected>0,'No positive modules without the async completion flag selected');
  assert.equal(counts.selected,counts.excludedByDeclaredFeature+counts.excludedByUnsupportedAttributes+
    counts.excludedByDynamicImportSyntax+
    counts.excludedByExecutionFeature+counts.admittedCandidates,'Every selected case must have a declared-scope classification');
  assert.equal(counts.admittedCandidates,counts.authorAdmissionRejected+counts.targetV8LinkRejected+counts.inScope,
    'Every execution candidate must have an outcome or an explicit exclusion');
  assert.equal(counts.inScope,counts.passed+counts.failed+counts.notExecuted,'Every in-scope case must have an execution outcome');
  assert.ok(counts.passed>=374,'Production execution coverage regressed');
  assert.ok(counts.excludedByDynamicImportSyntax<=1,'New untagged dynamic imports need review');
  assert.ok(counts.authorAdmissionRejected<=11,'Author admission rejected additional positive modules');
  assert.ok(counts.targetV8LinkRejected<=1,'Target V8 rejected additional positive modules');
  assert.equal(counts.failed+counts.notExecuted,0,'In-scope unexecuted and rejected modules are not conformance passes');
});
