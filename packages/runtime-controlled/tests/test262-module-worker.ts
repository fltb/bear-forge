import {parentPort, workerData} from 'node:worker_threads';
import {compileEntry} from '../../compiler/src/compile.ts';
import {AuthorAdmissionError} from '../../compiler/src/admission.ts';
import {ProgramExecution, decode} from '../src/execution.ts';
import type {Test262Execution} from '../../compiler/tests/test262-outcome.ts';
import {types} from 'node:util';
import {Script} from 'node:vm';
import {harnessSource,harnessOperations} from './test262-harness.ts';

const send = (execution: Test262Execution) => parentPort!.postMessage(execution);
let program: ProgramExecution | undefined;
let phase: 'compile' | 'load' | 'harness' | 'runtime' = 'compile';
let asyncCompleted=false,asyncFailure:string|null=null,acceptPrint=false;
function constructorName(error: unknown, global: Record<string,unknown>): string {
  if(error===null||typeof error!=='object'||types.isProxy(error))return 'nonstandard thrown value';
  const prototype=Object.getPrototypeOf(error);
  const testError=Object.getOwnPropertyDescriptor(global,'Test262Error')?.value;
  if(typeof testError==='function'&&prototype===testError.prototype)return 'Test262Error';
  if(!types.isNativeError(error))return 'nonstandard thrown value';
  const name=prototype&&Object.getOwnPropertyDescriptor(prototype,'name');
  return name&&'value' in name&&typeof name.value==='string'?name.value:'nonstandard thrown value';
}
try {
  const artifact = await compileEntry(workerData.entry,'program');
  phase = 'load';
  program = new ProgramExecution(decode(artifact.content));
  phase = 'harness';
  // Harness assertions retain Script global/strictness semantics, while their
  // property operations observe the active COW Context rather than raw shells.
  // Author modules remain unchanged and go through production admission.
  const realm = program.loaded.realm;
  const global = new Script('globalThis').runInContext(realm);
  const instanceGlobal = (program as any).context.globals;
  for (const key of ['Promise','WeakMap','WeakSet'])
    Object.defineProperty(global,key,program.loaded.enter((program as any).context,()=>program!.loaded.inspection.getOwnPropertyDescriptor(instanceGlobal,key))!);
  if(workerData.asynchronous)Object.defineProperty(global,'print',{configurable:true,writable:true,value(value:unknown){
    if(!acceptPrint)return;
    const message=String(value);
    if(message==='Test262:AsyncTestComplete')asyncCompleted=true;
    else if(message.startsWith('Test262:AsyncTestFailure:'))asyncFailure=message;
  }});
  Object.defineProperty(global,'__bearOps',{value:harnessOperations(program.loaded.effects.operations,global)});
  for (const helper of workerData.harness as {file:string;source:string}[])
    program.loaded.enter((program as any).context,()=>
      new Script(harnessSource(helper.source),{filename:`harness/${helper.file}`}).runInContext(realm));
  (program as any).context.globals = global;
  phase = 'runtime';
  acceptPrint=true;
  program.start(null);
  const result=program.result;
  if (program.fault) send({kind:'timeout'});
  else if (program.hostViolation) send({kind:'admission-rejected',phase:'runtime',reason:'Module attempted an undeclared host effect'});
  else if (result?.status===2) send({kind:'threw',phase:'runtime',constructorName:constructorName(result.value,global)});
  else if (result?.status !== 1 || result.value !== null) send({kind:'runner-error',message:'The production entry did not complete normally'});
  else if(workerData.asynchronous&&asyncFailure!==null)send({kind:'async-failure',message:asyncFailure});
  else if(workerData.asynchronous&&!asyncCompleted)send({kind:'timeout'});
  else send({kind:'completed'});
} catch (error) {
  if (error instanceof AuthorAdmissionError) send({kind:'admission-rejected',phase:'compile',reason:error.message});
  else if (program?.fault) send({kind:'timeout'});
  else if (program?.hostViolation) send({kind:'admission-rejected',phase:'runtime',reason:'Module attempted an undeclared host effect'});
  else if (phase !== 'runtime') send({kind:'runner-error',message:`${phase} failed: ${String(error)}`});
  else {
    // Do not read author-defined name/message/constructor properties.
    send({kind:'threw',phase:'runtime',constructorName:constructorName(error,(program as any).context.globals)});
  }
} finally {
  program?.dispose();
}
