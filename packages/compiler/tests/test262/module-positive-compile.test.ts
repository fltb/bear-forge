import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test262Cases,test262ExcludedFeatures,hasUnsupportedDynamicImport,
  hasUnsupportedImportAttributes,verifyTest262Checkout} from '../test262-cases.ts';
import {excludedAuthorFeatures} from '../test262-scope.ts';

test('pinned positive Test262 modules retain production compilation coverage',async t=>{
  const root=process.env.TEST262_ROOT;
  assert.ok(root,'Set TEST262_ROOT to a complete clean checkout of the pinned Test262 revision');
  await verifyTest262Checkout(root);
  const counts={selected:0,excludedByDeclaredFeature:0,excludedByUnsupportedAttributes:0,excludedByDynamicImportSyntax:0,
    admissionRejected:0,nativeLinkRejected:0,inScope:0,compiled:0,failed:0};
  const failures:{file:string;error:string}[]=[];
  const notExecuted:{file:string;reason:string}[]=[];
  const compilerRoot=fileURLToPath(new URL('../../',import.meta.url));
  for await(const candidate of test262Cases(root)){
    if(candidate.mode!=='module'||candidate.negative!==null)continue;
    counts.selected++;
    if(candidate.features.some(feature=>test262ExcludedFeatures.has(feature))){counts.excludedByDeclaredFeature++;continue;}
    if(hasUnsupportedImportAttributes(candidate.source)){counts.excludedByUnsupportedAttributes++;continue;}
    if(hasUnsupportedDynamicImport(candidate.source)){counts.excludedByDynamicImportSyntax++;continue;}
    // A compiler loop must fail this case, not block the entire conformance
    // classification. The child calls the unchanged production graph bundler;
    // policy rejection and target-V8 link rejection are distinct outcomes.
    const child=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',
      "import {bundleProgram} from './src/bundle.ts';import {AuthorAdmissionError} from './src/admission.ts';import {isNativeModuleLinkError} from './src/module-link.ts';try{await bundleProgram(process.argv[1]);console.log(JSON.stringify({kind:'compiled'}))}catch(error){console.log(JSON.stringify({kind:error instanceof AuthorAdmissionError?'admission':isNativeModuleLinkError(error)?'native-link':'failure',error:String(error)}))}",
      resolve(root,candidate.file)],{cwd:compilerRoot,timeout:20_000,encoding:'utf8',maxBuffer:1024*1024});
    let result:{kind:string;error?:string}|undefined;
    if(child.status===0){
      try{result=JSON.parse(child.stdout.trim());}catch{/* A malformed result is a runner failure. */}
    }
    if(result?.kind==='admission'){
      const excluded=await excludedAuthorFeatures(root,candidate);
      if(excluded.size){
        counts.admissionRejected++;
        notExecuted.push({file:candidate.file,reason:[...excluded].join(', ')});
      }else{
        counts.inScope++;
        counts.failed++;
        failures.push({file:candidate.file,error:result.error??'Unexplained author admission rejection'});
      }
    }else if(result?.kind==='native-link'){
      counts.nativeLinkRejected++;
      notExecuted.push({file:candidate.file,reason:result.error??'Target V8 rejected module linking'});
    }else{
      counts.inScope++;
      if(result?.kind==='compiled')counts.compiled++;
      else{
        counts.failed++;
        failures.push({file:candidate.file,error:result?.error??String(child.error??child.stderr??child.stdout).slice(-1200)});
      }
    }
    if(counts.selected%50===0)t.diagnostic(JSON.stringify({selected:counts.selected,failed:counts.failed}));
  }
  t.diagnostic(JSON.stringify({backend:'production-module-compile',counts,notExecuted,failures}));
  assert.ok(counts.selected>0,'No positive modules selected');
  assert.equal(counts.selected,counts.excludedByDeclaredFeature+counts.excludedByUnsupportedAttributes+counts.excludedByDynamicImportSyntax+
    counts.admissionRejected+counts.nativeLinkRejected+counts.inScope);
  assert.equal(counts.inScope,counts.compiled+counts.failed);
  // Coverage floors are for this pinned Test262 revision and target V8. A
  // future admission regression must not silently reclassify a legal module
  // as "not executed" while leaving the compilation assertion green.
  assert.ok(counts.compiled>=425,'Production compilation coverage regressed');
  assert.ok(counts.excludedByDynamicImportSyntax<=5,'New untagged dynamic imports need review');
  assert.ok(counts.admissionRejected<=18,'Author admission rejected additional positive modules');
  assert.ok(counts.nativeLinkRejected<=1,'Target V8 rejected additional positive modules');
  assert.equal(counts.failed,0,'In-scope positive modules were rejected during production compilation');
});
