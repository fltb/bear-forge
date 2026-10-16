import { parentPort, workerData } from 'node:worker_threads';
import { createContext, constants, Script, SourceTextModule, SyntheticModule, type Module, type Context } from 'node:vm';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import type { Test262Case } from './test262-cases.ts';
import type { Test262Execution } from './test262-outcome.ts';

if (!parentPort) throw Error('Reference adapter must run in a worker');
const port = parentPort;
const {test, root} = workerData as {test:Test262Case; root?:string};
let finished = false, evaluating = true, completed = false;
let failure: string | null = null, missing: string | null = null;
function finish(outcome: Test262Execution) {
  if (finished) return;
  finished = true;
  port.postMessage(missing ? { kind: 'runner-missing', reason: missing } : outcome);
}
function thrown(error: unknown, phase: 'parse' | 'resolution' | 'runtime'): Test262Execution {
  let constructorName = '<unknown>';
  try { constructorName = (error as { constructor?: { name?: string } } | null)?.constructor?.name ?? constructorName; } catch {}
  return { kind: 'threw', phase, constructorName };
}
function asynchronousCompletion() {
  if (evaluating || !test.asynchronous) return;
  if (failure !== null) finish({ kind: 'async-failure', message: failure });
  else if (completed) finish({ kind: 'completed' });
}
// Keep an async test alive until $DONE or the parent's external timeout.
port.on('message', () => {});
process.on('unhandledRejection', error => finish(thrown(error, 'runtime')));
process.on('uncaughtException', error => finish(thrown(error, 'runtime')));
const unavailable = (name: string) => {
  missing = `Reference host capability ${name} is not implemented`;
  finish({ kind: 'runner-missing', reason: missing });
  throw new Error(missing);
};
type ReferenceHost = {
  global: object;
  evalScript(source: string): unknown;
  createRealm(): ReferenceHost;
};
function createReferenceRealm(): {context: Context; host: ReferenceHost} {
  // The contextified proxy global changes declaration descriptors and cannot be
  // made non-extensible. Use the realm's ordinary global object for conformance.
  const context = createContext(constants.DONT_CONTEXTIFY);
  const global = new Script('globalThis').runInContext(context);
  const realmSyntaxError = new Script('SyntaxError').runInContext(context) as typeof SyntaxError;
  const host: ReferenceHost = {
    global,
    createRealm() { return createReferenceRealm().host; },
    evalScript(source: string) {
      let script: Script;
      try { script = new Script(source); }
      catch (error) {
        // vm parses in the host realm; the Test262 API reports a parse error
        // belonging to the realm in which evalScript was installed.
        if (error instanceof SyntaxError) throw new realmSyntaxError(error.message);
        throw error;
      }
      return script.runInContext(context);
    }
  };
  for (const name of ['detachArrayBuffer', 'gc', 'agent', 'IsHTMLDDA', 'AbstractModuleSource']) {
    Object.defineProperty(host, name, { configurable: true, get() { return unavailable(`$262.${name}`); } });
  }
  Object.defineProperties(global, {
    print: { configurable: true, writable: true, value(value: unknown) {
      const text = String(value);
      if (text === 'Test262:AsyncTestComplete') completed = true;
      else if (text.startsWith('Test262:AsyncTestFailure:')) failure = text;
      asynchronousCompletion();
    } },
    $262: { configurable: true, writable: true, value: host }
  });
  return {context, host};
}
const {context} = createReferenceRealm();
try {
  for (const helper of test.harness) new Script(helper.source, { filename: `harness/${helper.file}` }).runInContext(context);
} catch (error) { finish({ kind: 'runner-error', message: `Harness failed: ${String(error)}` }); }
async function moduleExecution() {
  let base:string;
  try {base=root?await realpath(root):resolve('/test262');}
  catch(error){finish({kind:'runner-error',message:'Module root could not be read: '+String(error)});return;}
  function contained(path: string): boolean {
    const suffix=relative(base,path);
    return suffix !== '' && suffix !== '..' && !suffix.startsWith('../') && !isAbsolute(suffix);
  }
  const mainPath=resolve(base,test.file);
  if(!contained(mainPath)) { finish({kind:'runner-error',message:'Test path escapes the module root'}); return; }
  const identifier=pathToFileURL(mainPath).href;
  const modules=new Map<string,Promise<Module>>();
  function parse(source:string,identifier:string):SourceTextModule {
    return new SourceTextModule(source,{
      context,identifier,
      initializeImportMeta(meta){meta.url=identifier;},
      importModuleDynamically(){return unavailable('dynamic module loading');}
    });
  }
  let main:SourceTextModule;
  try {main=parse(test.source,identifier);modules.set(identifier,Promise.resolve(main));}
  catch(error){finish(thrown(error,'parse'));return;}
  try {
    await main.link(async (specifier,referencing,extra)=>{
      const attributes=extra.attributes??{};
      const json=attributes.type==='json';
      if(Object.keys(attributes).some(key=>key!=='type')||Object.keys(attributes).length&&!json)
        return unavailable('module import attribute type unsupported by the reference adapter');
      if(!specifier.startsWith('./'))return unavailable('module specifier '+specifier);
      const url=new URL(specifier,referencing.identifier), path=fileURLToPath(url);
      if(url.search||url.hash||!contained(path))return unavailable('module path outside the declared fixture root');
      if(extname(path)!==(json?'.json':'.js'))return unavailable('module fixture format does not match import type');
      const key=url.href+(json?'\0json':'');
      const cached=modules.get(key);if(cached)return cached;
      if(!root)return unavailable('module fixture root');
      const loading=(async()=>{
        let source:string;
        try {
          const actual=await realpath(path);
          if(!contained(actual))throw Error('Fixture symlink escapes its root');
          source=await readFile(actual,'utf8');
        }catch(error){
          finish({kind:'runner-error',message:'Module fixture could not be read: '+String(error)});
          throw error;
        }
        if(json){
          // Let the target Node loader validate its supported format/attributes.
          // Parse the same bytes in the test realm: importing the host's value
          // would give JSON objects the wrong Object/Array prototypes.
          await import(url.href,{with:{type:'json'}});
          const parseJSON=new Script('JSON.parse').runInContext(context);
          const value=parseJSON(source.replace(/^\uFEFF/,''));
          return new SyntheticModule(['default'],function(){this.setExport('default',value);},{context,identifier:url.href});
        }
        return parse(source,url.href);
      })();
      modules.set(key,loading);return loading;
    });
  }catch(error){finish(thrown(error,'resolution'));return;}
  if(finished)return;
  try {
    await main.evaluate();evaluating=false;
    if(!test.asynchronous)finish({kind:'completed'});else asynchronousCompletion();
  }catch(error){finish(thrown(error,'runtime'));}
}
if (!finished && test.mode === 'module') {
  await moduleExecution();
} else if (!finished) {
  let script: Script | undefined;
  try { script = new Script(test.source, { filename: test.file }); }
  catch (error) { finish(thrown(error, 'parse')); }
  if (!finished) {
    try {
      script!.runInContext(context);
      evaluating = false;
      if (!test.asynchronous) finish({ kind: 'completed' });
      else asynchronousCompletion();
    } catch (error) { finish(thrown(error, 'runtime')); }
  }
}
