import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CardMachine,CardProgram,linkRules,ruleModules} from '@bear-forge/card-engine';
import {privateCardGraph} from '@bear-forge/runtime-card/graph';
import {ProbabilityCurrent} from '@bear-forge/runtime-card/probability';
import {ProbabilityExpansion} from '@bear-forge/runtime-card/probability-expansion';
import {unitMass,zeroMass,addMass} from '@bear-forge/card-engine/probability-cursor';
import {expandAll} from './probability-fixture.ts';
import {serialize,deserialize} from 'node:v8';
import {rules} from '../src/rules/execution.ts';
import {maps} from '../src/rules/maps.ts';
import {adventureStateSchema} from '../src/rules/adventures.schemas.ts';
import {generateMap,nodeAt,beginMapConstruction,advanceMapConstruction,mapDraw} from '../src/map.ts';
import type {SpireMap} from '../src/map.types.ts';

const setup=z.object({seed:z.bigint(),ascension:z.number(),act:z.number(),burning:z.boolean()});
const pause=ruleModules.portEffect<null,null>('pause');
const entry=rules.defineEffect<z.infer<typeof setup>,SpireMap>(b=>{const map=b.local<SpireMap>();return rules.sequence(rules.call(pause,null),b.assign(map,rules.call(maps.exports.generate,b.input)),b.return(map));});
const definition=linkRules<{},z.infer<typeof setup>,{pause:{input:null;output:null}},SpireMap>({id:'sts/map-probability',schemas:{setup,result:adventureStateSchema.shape.map,ports:{pause:{input:z.null(),output:z.null()}}},initialize:()=>({}),entry,definitions:[entry,pause],modules:[maps]});
function current(seed:bigint,act=2,burning=true){const program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial({seed,act,burning,ascension:20})));assert.equal(machine.advance().kind,'call');return new ProbabilityCurrent(machine);}
function assertMap(map:SpireMap,burning:boolean){
  assert.equal(map.nodes.length,105);
  for(const node of map.nodes){
    for(const x of node.edges){assert.ok(x>=0&&x<7);if(node.y<14)assert.ok(nodeAt(map,x,node.y+1).parents.includes(node.x));}
    if(node.edges.length){if(node.y===0)assert.equal(node.room,'MONSTER');if(node.y===8)assert.equal(node.room,'TREASURE');if(node.y===14)assert.equal(node.room,'REST');}
  }
  if(burning){assert.equal(nodeAt(map,map.burningEliteX,map.burningEliteY).room,'ELITE');assert.ok(map.burningEliteBuff>=0&&map.burningEliteBuff<=3);}
  else assert.equal(map.burningEliteX,-1);
}
test('all map acts expose complete random coordinates and retain the unfinished joint space across cold restoration',()=>{
  for(const act of [1,2,3])for(const seed of [130n,999n])for(const burning of [false,true]){
    const root=current(seed,act,burning),before=root.machine.storage.export(root.machine.root),initial=CardProgram.prototype.initial;
    let expansion=ProbabilityExpansion.from(root,null,null);
    try{
      CardProgram.prototype.initial=function(){throw Error('A pending map cannot initialize or replay');};
      let preparation=0;
      while(!expansion.save().pending.some(row=>row.phase==='chance')){assert.ok(++preparation<30);assert.equal(expansion.step(),true);}
      const start=expansion.save().pending.find(row=>row.phase==='chance')!;
      assert.equal(start.phase,'chance');if(start.phase!=='chance')throw Error('Missing first map coordinate');
      assert.deepEqual(start.cursor,{space:{kind:'uniform',size:7n},next:0n,remaining:unitMass()});
      expansion.step();
      const split=expansion.save();
      assert.ok(split.pending.some(row=>row.phase==='advance'&&row.reply===0n&&row.mass.numerator===1n&&row.mass.denominator===7n));
      assert.ok(split.pending.some(row=>row.phase==='chance'&&row.cursor.next===1n&&row.cursor.remaining.numerator===6n&&row.cursor.remaining.denominator===7n));
      for(let step=0;step<32;step++){
        assert.equal(expansion.step(),true);const mass=expansion.masses();
        assert.deepEqual(addMass(addMass(mass.pending,mass.ready),mass.transferred),unitMass());
        const saved=deserialize(serialize(expansion.save()));expansion.close();
        expansion=ProbabilityExpansion.restore(root.machine.program,saved);assert.deepEqual(expansion.save(),saved);
      }
      assert.equal(expansion.complete,false);assert.equal(expansion.take(),undefined);
      assert.deepEqual(expansion.masses(),{pending:unitMass(),ready:zeroMass(),transferred:zeroMass()});
      assert.deepEqual(root.machine.storage.export(root.machine.root),before);
    }finally{CardProgram.prototype.initial=initial;expansion.close();root.close();}
  }
});

test('a map probability path resumes each current draw without native RNG seeds choosing its future',()=>{
 const maps:SpireMap[]=[];
 for(const seed of [130n,999n]){
  let node=current(seed,2,true);const program=node.machine.program,initialize=CardProgram.prototype.initial;
  try{
   CardProgram.prototype.initial=()=>{throw Error('Cold map continuation cannot initialize');};
   let stop=node.advanceExact(null),draws=0,slices=0;
   while(stop.kind!=='done'){
    assert.ok(++slices<10000,'fixture branch reaches the original final map');
    const saved=deserialize(serialize(node.machine.storage.export(node.machine.root)));
    node.close();node=new ProbabilityCurrent(new CardMachine(program,privateCardGraph(saved)));
    assert.deepEqual(node.inspectExact(),stop);
    if(stop.kind==='yield')stop=node.advanceExact();
    else{
     assert.equal(stop.kind,'chance');if(stop.kind!=='chance'||stop.space.kind!=='uniform')throw Error('Expected an elementary map draw');
     const coordinate=BigInt(draws++)%stop.space.size;
     stop=node.advanceExact(coordinate);
    }
   }
   assert.ok(draws>80);assertMap(stop.result,true);maps.push(stop.result);
  }finally{CardProgram.prototype.initial=initialize;node.close();}
 }
 assert.deepEqual(maps[0],maps[1],'identical future coordinates have identical maps independently of the actual hidden seed');
});

test('second-path rejection and originally selected destination remain explicit construction state',()=>{
 let work=advanceMapConstruction(beginMapConstruction(20,1,false),0);
 for(let y=0;y<14;y++)work=advanceMapConstruction(work,0);
 assert.equal(work.phase,'start');assert.equal(work.path,1);assert.equal(work.first,0);
 const before=structuredClone(work);
 for(let rejected=0;rejected<12;rejected++){
  work=advanceMapConstruction(deserialize(serialize(work)),0);assert.deepEqual(work,before);
  assert.deepEqual(mapDraw(work),{start:0,end:6,counted:true},'rejection keeps all seven original next draws, including another rejection');
 }
 work=advanceMapConstruction(work,1);assert.equal(work.phase,'step');assert.equal(work.x,1);
 const adjustment=beginMapConstruction(20,1,false);adjustment.phase='step';adjustment.x=3;adjustment.y=4;
 for(const x of [2,3,4])nodeAt(adjustment.map,x,4).parents=[1];
 nodeAt(adjustment.map,4,5).parents=[2,4];
 let selected=advanceMapConstruction(adjustment,1);assert.equal(selected.phase,'adjust');assert.equal(selected.destination,4);
 selected=advanceMapConstruction(deserialize(serialize(selected)),-1);
 assert.equal(selected.next,2);assert.equal(selected.destination,4);assert.equal(selected.phase,'adjust');assert.equal(selected.parent,2);
 selected=advanceMapConstruction(deserialize(serialize(selected)),1);
 assert.deepEqual(nodeAt(selected.map,3,4).edges,[4]);assert.deepEqual(nodeAt(adjustment.map,3,4).edges,[],'parent state stays isolated');
});
test('normal map kernel keeps seeded maps, and the final act has exact singleton support without entropy',()=>{
  for(const act of [1,2,3,4]){const source=current(130n,act);try{const stop=source.machine.advance(null);assert.deepEqual(stop,{kind:'done',result:generateMap(130n,20,act,true)});if(act!==4&&stop.kind==='done')assertMap(stop.result,true);}finally{source.close();}}
  const source=current(999n,4),result=expandAll(source,null);
  try{assert.equal(result.outcomes.length,1);assert.deepEqual(result.outcomes[0]!.current.inspect(),{kind:'done',result:generateMap(130n,20,4,true)});}
  finally{for(const child of result.outcomes)child.current.close();source.close();}
});
