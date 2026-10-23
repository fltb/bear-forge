import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {parse} from '@babel/parser';
import type {Node} from '@babel/types';

const root=new URL('../src/content/enemies/',import.meta.url);
// Only semantic implementations and construction own mutation privileges.
const implementations=new Set(['shared/operations.ts','shared/card-operations.ts','shared/deploy-operation.ts','shared/programs.ts','shared/cards.ts','shared/construction.ts','shared/deployment.ts']);
const forbidden:Readonly<Record<string,readonly string[]>>={
  resources:['setHealth','limitHp','loseHp','loseHpDetailed','heal','gainBlock','consumeBlock','spendGold','seizeGold'],
  powers:['apply','restore','merge','set','remove','deactivate','decrement','clearJustApplied'],
  enemies:['finishRevival','setFlags','claim','openOpportunity'],
  battles:['hit','endTurnEarly','setEnemies'],turns:['setEnemies','seekEnemy'],combatSessions:['setRoster'],
  zones:['move'],cardPiles:['create','register','unregister','moveToHand','attachZone'],permanentDecks:['obtain'],
};
function visit(node:unknown,fn:(n:Node)=>void):void{
  if(!node||typeof node!=='object')return;
  if('type' in node&&typeof node.type==='string')fn(node as Node);
  for(const [key,value]of Object.entries(node))if(!['loc','extra','start','end'].includes(key)){
    if(Array.isArray(value))for(const child of value)visit(child,fn);else if(value&&typeof value==='object')visit(value,fn);
  }
}
function violations(source:string,file:string):string[]{
  const tree=parse(source,{sourceType:'module',plugins:['typescript']}),errors:string[]=[],bindings=new Map<string,string>();
  visit(tree,n=>{if(n.type==='ImportDeclaration')for(const spec of n.specifiers)if(spec.type==='ImportSpecifier')bindings.set(spec.local.name,spec.imported.type==='Identifier'?spec.imported.name:spec.imported.value);});
  visit(tree,n=>{
    if(n.type==='ImportDeclaration'&&n.importKind!=='type'){
      if(n.source.value==='@bear-forge/card-engine')errors.push('content cannot import raw Core');
      if(n.specifiers.some(s=>s.type==='ImportSpecifier'&&s.imported.type==='Identifier'&&s.imported.name==='defineOperation')&&!implementations.has(file))errors.push('content cannot define privileged operations');
    }
    if(n.type==='MemberExpression'&&!implementations.has(file)&&!n.computed&&n.property.type==='Identifier'&&n.property.name==='atom')errors.push('content cannot define raw mutation atoms');
    if(n.type==='ObjectExpression'&&file!=='shared/programs.ts'){
      const keys=n.properties.filter(p=>p.type==='ObjectProperty'&&p.key.type==='Identifier').map(p=>p.type==='ObjectProperty'&&p.key.type==='Identifier'?p.key.name:'');
      if(['attack','damage','hits'].every(k=>keys.includes(k)))errors.push('intent cannot be authored as a second attack specification');
    }
    if(n.type==='MemberExpression'&&!n.computed&&n.property.type==='Identifier'){
      const parent=n.object;
      if(parent.type==='MemberExpression'&&!parent.computed&&parent.property.type==='Identifier'&&parent.property.name==='exports'&&parent.object.type==='Identifier'){
        const owner=bindings.get(parent.object.name)??parent.object.name;
        if(forbidden[owner]?.includes(n.property.name)&&!implementations.has(file))errors.push(`${owner}.${n.property.name} bypasses semantic operations`);
      }
    }
    if(n.type==='ObjectProperty'&&n.key.type==='Identifier'&&n.key.name==='output'&&n.value.type==='Identifier'&&n.value.name==='enemyIntentSchema'&&file!=='shared/programs.ts')errors.push('intent must derive from attack operations');
    if(n.type==='CallExpression'&&n.callee.type==='Identifier'&&['attachAbilities','effectAbility'].includes(n.callee.name))errors.push('enemy abilities require explicit semantic roles');
  });return errors;
}
async function files(url:URL):Promise<URL[]>{return(await Promise.all((await readdir(url,{withFileTypes:true})).map(e=>e.isDirectory()?files(new URL(e.name+'/',url)):Promise.resolve(e.name.endsWith('.ts')?[new URL(e.name,url)]:[])))).flat();}

test('all enemy content uses closed semantic operations and shared attack intents',async()=>{
  const errors:string[]=[];
  for(const url of await files(root)){const file=fileURLToPath(url).slice(fileURLToPath(root).length);errors.push(...violations(await readFile(url,'utf8'),file).map(e=>`${file}: ${e}`));}
  assert.deepEqual(errors,[]);
});
test('boundary rejects aliased raw mutations, custom intents and privileged callbacks',()=>{
  for(const source of [
    "import {resources as r} from '../../../rules/resources.ts'; const x=r.exports.setHealth;",
    "import {powers as p} from '../../../rules/powers.ts'; const x=p.exports.set;",
    "import {defineOperation as operation} from '../../../rules/combat-operations.ts';",
    'const x={output:enemyIntentSchema};',
    'const x=attachAbilities(a);',
    'const x=m.atom({});',
    'const x={attack:true,damage:1,hits:2};',
  ])assert.ok(violations(source,'city/example.ts').length>0,source);
});
