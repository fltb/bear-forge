import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import assert from 'node:assert/strict';
const root=resolve('.'), contracts=resolve('packages/contracts/src'), game=resolve('games/doudizhu/src');
const files=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(resolve(dir,e.name)):e.name.endsWith('.ts')?[resolve(dir,e.name)]:[]);
const errors:string[]=[];
const forbidden=new Set(['Date','globalThis','process','window','document','fetch','WebSocket','require','eval','Function','setTimeout','setInterval','Worker','Atomics']);
for(const path of [...files(contracts),...files(game)]){
  const source=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true),label=relative(root,path),isContract=path.startsWith(contracts+'/');
  const visit=(node:ts.Node)=>{
    if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier){
      if(!ts.isStringLiteral(node.moduleSpecifier))errors.push(`${label}: dynamic module`);
      else {
        const name=node.moduleSpecifier.text;
        if(name.startsWith('.')){
          const target=resolve(dirname(path),name),base=isContract?contracts:game;
          if(!target.startsWith(base+'/'))errors.push(`${label}: import escapes layer`);
          if(path.startsWith(contracts+'/core/')&&!target.startsWith(contracts+'/core/'))errors.push(`${label}: Core depends on another layer`);
          if(path.startsWith(contracts+'/game/')&&!target.startsWith(contracts+'/game/')&&!target.startsWith(contracts+'/core/'))errors.push(`${label}: Game capability definitions depend on runtime`);
        } else if(name!=='zod'&&(isContract||name!=='@bear-forge/contracts'))errors.push(`${label}: external dependency ${name}`);
      }
    }
    if(ts.isInterfaceDeclaration(node))errors.push(`${label}: use explicit type aliases for capabilities`);
    if(isContract){
      if(ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node))errors.push(`${label}: protocol implementation/factory`);
      if(ts.isArrowFunction(node)||ts.isFunctionExpression(node)){
        const p=node.parent;
        if(!ts.isCallExpression(p)||!ts.isPropertyAccessExpression(p.expression)||!['refine','superRefine'].includes(p.expression.name.text))errors.push(`${label}: executable protocol factory/helper`);
      }
    } else {
      if(ts.isIdentifier(node)&&forbidden.has(node.text))errors.push(`${label}: forbidden host global ${node.text}`);
      if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword)errors.push(`${label}: dynamic import`);
      if(ts.isPropertyAccessExpression(node)&&node.expression.getText(source)==='Math'&&node.name.text==='random')errors.push(`${label}: uncontrolled random`);
    }
    ts.forEachChild(node,visit);
  };
  visit(source);
}
assert.deepEqual(errors,[]);
const pkg=JSON.parse(readFileSync('node_modules/zod/package.json','utf8'));assert.equal(pkg.version,'4.6.5');assert.deepEqual(Object.keys(pkg.dependencies??{}),[]);
console.log('PASS: Core/Game contracts separated; no protocol factories; game imports only local implementation/public contracts/Zod');
console.log('LIMIT: source dependency audit, not a controlled compiler or runtime sandbox proof');
