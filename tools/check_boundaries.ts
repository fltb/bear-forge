import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import assert from 'node:assert/strict';
const root=resolve('.'), contracts=resolve('packages/contracts/src'), game=resolve('games/doudizhu/src'), sdk=resolve('packages/game-sdk/src');
const files=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(resolve(dir,e.name)):e.name.endsWith('.ts')?[resolve(dir,e.name)]:[]);
const errors:string[]=[];
const forbidden=new Set(['Date','globalThis','process','window','document','fetch','WebSocket','require','eval','Function','setTimeout','setInterval','Worker','Atomics']);
for(const path of [...files(contracts),...files(game),...files(sdk)]){
  const source=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true),label=relative(root,path),isContract=path.startsWith(contracts+'/'),isSDK=path.startsWith(sdk+'/');
  const visit=(node:ts.Node)=>{
    if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier){
      if(!ts.isStringLiteral(node.moduleSpecifier))errors.push(`${label}: dynamic module`);
      else {
        const name=node.moduleSpecifier.text;
        if(name.startsWith('.')){
          const target=resolve(dirname(path),name),base=isContract?contracts:isSDK?sdk:game;
          if(!target.startsWith(base+'/'))errors.push(`${label}: import escapes layer`);
          if(isContract){
            const layer=relative(contracts,path).split('/')[0]!,dependency=relative(contracts,target).split('/')[0]!;
            const allowed:Record<string,string[]>={core:['core','internal','instance'],instance:['instance','internal','core'],game:['game','instance','internal'],authoring:['authoring','core','game','internal'],persistence:['persistence','core','instance'],branching:['branching','instance'],capture:['capture','core','instance'],loading:['loading','core','instance','game','authoring','persistence','capture','session','internal'],session:['session','instance','game'],internal:['internal']};
            if(allowed[layer]&&!allowed[layer]!.includes(dependency))errors.push(`${label}: forbidden layer dependency ${dependency}`);
          }
        } else if(isSDK){
          if(!['@bear-forge/contracts/core','@bear-forge/contracts/authoring'].includes(name)||!ts.isImportDeclaration(node)||!node.importClause?.isTypeOnly)errors.push(`${label}: SDK may import only public IO/authoring types`);
        } else if(name!=='zod'&&(isContract||!['@bear-forge/contracts','@bear-forge/contracts/core','@bear-forge/contracts/authoring','@bear-forge/contracts/game','@bear-forge/contracts/loading','@bear-forge/game-sdk'].includes(name)))errors.push(`${label}: external dependency ${name}`);
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
console.log('PASS: three-layer and optional capability dependency graph; public declarations, inner SDK and game imports stay within their allowed paths');
console.log('LIMIT: source dependency audit, not a controlled compiler or runtime sandbox proof');
