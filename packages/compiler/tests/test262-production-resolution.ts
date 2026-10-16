import {resolve} from 'node:path';
import {bundleProgram} from '../src/bundle.ts';
import {AuthorAdmissionError,isAuthorParseError} from '../src/admission.ts';
import {isNativeModuleLinkError} from '../src/module-link.ts';
import {isDependencyResolutionError} from '../src/module-resolution.ts';
import type {Test262Case} from './test262-cases.ts';

export type ProductionResolutionResult={
  file:string;
  backend:'production-module-resolution';
  status:'passed'|'failed'|'not-executed';
  outcome:'resolution-error'|'resolution-accepted'|'admission-rejected'|'wrong-phase'|'compiler-error'|'runner-missing';
  detail:string;
};

/** Phase-only production graph check. Harness code and the test body never run.
 * A generic SyntaxError is insufficient evidence: only a tagged native link
 * failure or imported-source parse failure has resolution-phase provenance. */
export async function runTest262ProductionResolution(test:Test262Case,root:string):Promise<ProductionResolutionResult>{
  const base={file:test.file,backend:'production-module-resolution' as const};
  if(test.mode!=='module'||test.negative?.phase!=='resolution')return{
    ...base,status:'not-executed',outcome:'runner-missing',detail:'This adapter checks module resolution-negative cases only'
  };
  try{
    await bundleProgram(resolve(root,test.file));
    return {...base,status:'failed',outcome:'resolution-accepted',detail:'Production linker accepted a graph requiring a resolution error'};
  }catch(error){
    if(isNativeModuleLinkError(error)||isDependencyResolutionError(error))return{
      ...base,status:error.constructor.name===test.negative.type?'passed':'failed',
      outcome:'resolution-error',detail:error.constructor.name
    };
    if(error instanceof AuthorAdmissionError)return{
      ...base,status:'not-executed',outcome:'admission-rejected',detail:error.message
    };
    if(isAuthorParseError(error))return{
      ...base,status:'failed',outcome:'wrong-phase',detail:error.constructor.name
    };
    return {...base,status:'not-executed',outcome:'compiler-error',detail:String(error)};
  }
}
