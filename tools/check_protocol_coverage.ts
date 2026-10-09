/** Inventory completeness only: this tool cannot certify the truth of a proof. */
import ts from 'typescript';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root=resolve('.'),base=resolve('packages/contracts/src'),entry=resolve(base,'index.ts');
const config=ts.readConfigFile('tsconfig.json',ts.sys.readFile);
if(config.error)throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText,'\n'));
const options=ts.parseJsonConfigFileContent(config.config,ts.sys,root).options;
const program=ts.createProgram([entry],options),checker=program.getTypeChecker();
const source=program.getSourceFile(entry);assert.ok(source);
const moduleSymbol=checker.getSymbolAtLocation(source);assert.ok(moduleSymbol);
const definitions=checker.getExportsOfModule(moduleSymbol).map(symbol=>{
  const target=symbol.flags&ts.SymbolFlags.Alias?checker.getAliasedSymbol(symbol):symbol;
  const decl=target.declarations?.[0];assert.ok(decl);
  const file=resolve(decl.getSourceFile().fileName);assert.ok(file.startsWith(base+'/'));
  return {name:symbol.name,source:relative(root,file)};
}).sort((a,b)=>a.name.localeCompare(b.name));
const sources=Object.fromEntries(program.getSourceFiles().filter(s=>resolve(s.fileName).startsWith(base+'/')).map(s=>[relative(root,resolve(s.fileName)),createHash('sha256').update(readFileSync(s.fileName)).digest('hex')]).sort(([a],[b])=>a!.localeCompare(b!)));

type Law={id:string;claim:string;status:'structural'|'conditional'|'open';assumptions:string[];argument:string;evidence:string[];openObligations:string[]};
type Inventory={scope:string;sources:Record<string,string>;laws:Law[];definitions:{name:string;source:string;laws:string[]}[]};
const check=(inventory:Inventory)=>{
  assert.equal(inventory.scope,'public-contract-definitions');
  assert.deepEqual(inventory.sources,sources,'public/transitive local sources changed: review coverage and premises');
  assert.equal(new Set(inventory.laws.map(l=>l.id)).size,inventory.laws.length,'duplicate law');
  const laws=new Map(inventory.laws.map(l=>[l.id,l]));
  for(const law of laws.values()){
    assert.ok(law.claim.trim().length>0);assert.ok(['structural','conditional','open'].includes(law.status));
    assert.ok(law.assumptions.length>0,'no unconditional claims through omitted assumptions');
    assert.ok(existsSync(law.argument),`missing argument: ${law.argument}`);
    assert.ok(law.evidence.length>0);for(const path of law.evidence)assert.ok(existsSync(path),`missing evidence: ${path}`);
    if(law.status==='open')assert.ok(law.openObligations.length>0);
  }
  assert.equal(new Set(inventory.definitions.map(d=>d.name)).size,inventory.definitions.length,'duplicate export');
  const actual=[...inventory.definitions].sort((a,b)=>a.name.localeCompare(b.name));
  assert.deepEqual(actual.map(({name,source})=>({name,source})),definitions,'missing/extra/moved public definition');
  const used=new Set<string>();
  for(const definition of actual){
    assert.ok(definition.laws.length>0,`uncovered ${definition.name}`);
    assert.equal(new Set(definition.laws).size,definition.laws.length,'duplicate association');
    for(const id of definition.laws){assert.ok(laws.has(id),`unknown law: ${id}`);used.add(id);}
  }
  assert.equal(used.size,laws.size,'orphaned law');
};
if(process.argv.includes('--list')){
  console.log(JSON.stringify({sources,definitions},null,2));
}else{
  const inventory:Inventory=JSON.parse(readFileSync('evidence/C01/protocol-proof-index.json','utf8'));check(inventory);
  console.log(`PASS: ${definitions.length} public definitions covered by ${inventory.laws.length} named law groups`);
  console.log(`OPEN: ${inventory.laws.filter(l=>l.openObligations.length>0).length} law groups retain outstanding obligations; coverage is not correctness proof`);
  if(process.argv.includes('--self-test')){
    const reject=(label:string,change:(copy:Inventory)=>void)=>{const copy=structuredClone(inventory);change(copy);assert.throws(()=>check(copy));console.log(`PASS: reject ${label}`);};
    reject('missing export',x=>{x.definitions.pop();});
    reject('extra export',x=>{x.definitions.push({name:'Invented',source:entry,laws:[x.laws[0]!.id]});});
    reject('duplicate export',x=>{x.definitions.push(x.definitions[0]!);});
    reject('uncovered export',x=>{x.definitions[0]!.laws=[];});
    reject('unknown law',x=>{x.definitions[0]!.laws=['invented'];});
    reject('stale source',x=>{x.sources[Object.keys(x.sources)[0]!]='changed';});
    reject('unsupported completion label',x=>{Reflect.set(x.laws[0]!,'status','proved-all');});
    reject('missing evidence',x=>{x.laws[0]!.evidence=['evidence/C01/nonexistent-proof-file'];});
  }
}
