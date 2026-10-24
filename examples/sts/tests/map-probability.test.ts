import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CardMachine,CardProgram,linkRules,ruleModules} from '@bear-forge/card-engine';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {ProbabilityCurrent,nextProbability} from '../../../packages/runtime-card/src/probability.ts';
import {searchEntropyWord} from '../../../packages/policies/src/search/entropy.ts';
import {rules} from '../src/rules/execution.ts';
import {maps} from '../src/rules/maps.ts';
import {adventureStateSchema} from '../src/rules/adventures.schemas.ts';
import {generateMap,nodeAt} from '../src/map.ts';
import type {SpireMap} from '../src/map.types.ts';

const setup=z.object({seed:z.bigint(),ascension:z.number(),act:z.number(),burning:z.boolean()});
const pause=ruleModules.portEffect<null,null>('pause');
const entry=rules.defineEffect<z.infer<typeof setup>,SpireMap>(b=>{const map=b.local<SpireMap>();return rules.sequence(rules.call(pause,null),b.assign(map,rules.call(maps.exports.generate,b.input)),b.return(map));});
const definition=linkRules<{},z.infer<typeof setup>,{pause:{input:null;output:null}},SpireMap>({id:'sts/map-probability',schemas:{setup,result:adventureStateSchema.shape.map,ports:{pause:{input:z.null(),output:z.null()}}},initialize:()=>({}),entry,definitions:[entry,pause],modules:[maps]});
function current(seed:bigint,act=2,burning=true){const program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial({seed,act,burning,ascension:20})));assert.equal(machine.advance().kind,'call');return new ProbabilityCurrent(machine);}
function entropy(){let cursor={state:18273,position:0};return{word(){const r=searchEntropyWord(cursor);cursor=r.random;return r.value;},check(){}};}
function assertMap(map:SpireMap,burning:boolean){
  assert.equal(map.nodes.length,105);
  for(const node of map.nodes){
    for(const x of node.edges){assert.ok(x>=0&&x<7);if(node.y<14)assert.ok(nodeAt(map,x,node.y+1).parents.includes(node.x));}
    if(node.edges.length){if(node.y===0)assert.equal(node.room,'MONSTER');if(node.y===8)assert.equal(node.room,'TREASURE');if(node.y===14)assert.equal(node.room,'REST');}
  }
  if(burning){assert.equal(nodeAt(map,map.burningEliteX,map.burningEliteY).room,'ELITE');assert.ok(map.burningEliteBuff>=0&&map.burningEliteBuff<=3);}
  else assert.equal(map.burningEliteX,-1);
}
test('future maps use the original generator with independent entropy and leave their current Context untouched',()=>{
  for(const burning of [false,true]){
    const left=current(130n,2,burning),right=current(999n,2,burning),before=left.machine.storage.export(left.machine.root),initial=CardProgram.prototype.initial;
    CardProgram.prototype.initial=function(){throw Error('Map successors must not reinitialize');};
    try{
      const a=nextProbability(left,null,{maximum:4,entropy:entropy()}),b=nextProbability(right,null,{maximum:4,entropy:entropy()});
      try{assert.equal(a.representation,'particles');assert.equal(a.outcomes.length,4);assert.deepEqual(a.outcomes.map(o=>o.current.inspect()),b.outcomes.map(o=>o.current.inspect()));
        const distinct=new Set<string>();for(const child of a.outcomes){assert.equal(child.probability,.25);const stop=child.current.inspect();if(stop.kind!=='done')throw Error('Expected future map');assertMap(stop.result,burning);distinct.add(JSON.stringify(stop.result));}assert.ok(distinct.size>1);
        assert.deepEqual(left.machine.storage.export(left.machine.root),before);
      }finally{for(const child of [...a.outcomes,...b.outcomes])child.current.close();}
    }finally{CardProgram.prototype.initial=initial;left.close();right.close();}
  }
});
test('normal map kernel keeps seeded maps, and the final act has exact singleton support without entropy',()=>{
  for(const act of [1,2,3,4]){const source=current(130n,act);try{assert.deepEqual(source.machine.advance(null),{kind:'done',result:generateMap(130n,20,act,true)});}finally{source.close();}}
  const source=current(999n,4),result=nextProbability(source,null,{maximum:8,entropy:{word(){throw Error('Fixed map must not sample');},check(){}}});
  try{assert.equal(result.representation,'exact');assert.equal(result.outcomes.length,1);assert.deepEqual(result.outcomes[0]!.current.inspect(),{kind:'done',result:generateMap(130n,20,4,true)});}
  finally{for(const child of result.outcomes)child.current.close();source.close();}
});
