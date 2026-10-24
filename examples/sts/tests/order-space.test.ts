import {prefixOrderChoices,samplePrefixOrder,partitionPrefixOrder,partitionFullOrder,groupOrder,orderCoordinate} from '../src/rules/order-space.ts';
import {permutationAt,permutationCount} from '../../../packages/card-engine/src/probability.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CardProgram,CardMachine,linkRules,ruleModules} from '@bear-forge/card-engine';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {ProbabilityCurrent,nextProbability} from '../../../packages/runtime-card/src/probability.ts';
import {blockLanguage,sampleLanguage} from '../src/rules/order-language.ts';
import {searchEntropyWord} from '../../../packages/policies/src/search/entropy.ts';
import {rules} from '../src/rules/execution.ts';
import {zones} from '../src/rules/zones.ts';
import {orderSize,orderAt,revealOrdered,revealPositions,insertOrdered,removeOrdered,randomInsertion,appendExchangeable,canonicalOrder,observeLastMatch,topOrderChoices,topOrderAt,type OrderKnowledge} from '../src/rules/order-space.ts';

test('stable grouping is the exact pushforward of all original shuffles and proposals preserve full suffix variation',()=>{
  const items=[0,1,2,3,4],groups=[[0,2],[1,3,4]],counts=new Map<string,number>();
  for(let c=0n;c<permutationCount(items.length);c++){
    const shuffled=permutationAt(items,c),expected=[...shuffled.filter(i=>i===0||i===2),...shuffled.filter(i=>i!==0&&i!==2)],order=groupOrder(shuffled,groups);
    assert.deepEqual(order,expected);const key=JSON.stringify(order);counts.set(key,(counts.get(key)??0)+1);
    assert.deepEqual(orderAt(groups,orderCoordinate(groups,order)),order);
  }
  assert.equal(counts.size,12);assert.ok([...counts.values()].every(count=>count===10));
  let cursor={state:13,position:0};const source={check(){},word(){const next=searchEntropyWord(cursor);cursor=next.random;return next.value;}};
  const result=partitionFullOrder(groups,[4,3],8,source)!;
  const outcomes=result.outcomes.map(row=>{assert.equal(typeof row.coordinate,'bigint');return{...row,order:orderAt(groups,row.coordinate as bigint)};});
  const matching=outcomes.filter(row=>JSON.stringify(row.order.slice(-2))==='[3,4]');
  assert.equal(matching.length,2);assert.ok(matching.every(row=>row.probability===1/12));
  assert.equal(new Set(matching.map(row=>JSON.stringify(row.order.slice(0,2)))).size,2,'the unobserved creation order must remain variable');
  assert.ok(Math.abs(outcomes.reduce((sum,row)=>sum+row.probability,0)-1)<1e-12);
  assert.ok(Math.abs(outcomes.filter(row=>!matching.includes(row)).reduce((sum,row)=>sum+row.probability,0)-5/6)<1e-12);
  assert.equal(result.representation,'particles');
});

test('large full-order proposals sample both complete strata without fixing a canonical tail',()=>{
  const blocks=[Array.from({length:10},(_,i)=>i)],tails=new Set<string>();let cursor={state:13,position:0};
  const source={check(){},word(){const next=searchEntropyWord(cursor);cursor=next.random;return next.value;}};
  for(let i=0;i<12;i++){
    const result=partitionFullOrder(blocks,[9,8],8,source)!;assert.equal(result.representation,'particles');assert.equal(result.outcomes.length,2);
    const rows=result.outcomes.map(row=>({weight:row.probability,order:orderAt(blocks,row.coordinate as bigint)})),matching=rows.filter(row=>row.order.at(-1)===9&&row.order.at(-2)===8);
    assert.equal(matching.length,1);assert.ok(Math.abs(matching[0]!.weight-1/90)<1e-12);assert.ok(Math.abs(rows.reduce((sum,row)=>sum+row.weight,0)-1)<1e-12);tails.add(JSON.stringify(matching[0]!.order.slice(0,-2)));
  }
  assert.ok(tails.size>1);
});

test('ordered exchangeable blocks enumerate only their legal permutations',()=>{
  const blocks=[[9],[0,1,2],[8],[3,4]],size=orderSize(blocks);
  assert.equal(size,12n);
  const values=Array.from({length:Number(size)},(_,i)=>orderAt(blocks,BigInt(i)));
  assert.equal(new Set(values.map(v=>JSON.stringify(v))).size,12);
  for(const value of values){assert.equal(value[0],9);assert.equal(value[4],8);assert.deepEqual(value.slice(1,4).sort(),[0,1,2]);assert.deepEqual(value.slice(5).sort(),[3,4]);}
  assert.throws(()=>orderAt(blocks,size));
});
test('revealing a top prefix conditions the remaining block without retaining its hidden order',()=>{
  const before={blocks:[[0,1,2,3]],resolved:false,unsupported:false};
  const after=revealOrdered(before,[2,0,3,1],2);
  assert.deepEqual(after.blocks,[[0,2],[3],[1]]);assert.equal(orderSize(after.blocks),2n);
  assert.deepEqual(orderAt(after.blocks,0n),[0,2,3,1]);assert.deepEqual(orderAt(after.blocks,1n),[2,0,3,1]);
  assert.equal(insertOrdered(before,7,2).unsupported,false);assert.ok(insertOrdered(before,7,2).language);
});

const {defineRules,defineEntity,defineEffect,sequence,forEach,call,query,spawnEntity,when}=rules;
const items=defineRules({requires:[zones],build:m=>({exports:{kind:m.kind({config:z.undefined(),components:[zones.exports.member]})}})});
const item=defineEntity(items.exports.kind,undefined),zone=defineEntity(zones.exports.kind,{capacity:null});
const pause=ruleModules.portEffect<number[],null>('pause');
const setup=z.object({order:z.array(z.number()),reveal:z.number(),middle:z.boolean(),random:z.boolean().optional(),padding:z.number().int().nonnegative().optional()});
const entry=defineEffect<z.infer<typeof setup>,number[]>(b=>{
  const cards=b.local<number[]>(),pile=b.local<number>(),made=b.local<number>();
  const logical=(v:rules.ReadView<z.infer<typeof setup>>)=>v.query(zones.exports.members,v.get(pile)).map(id=>v.get(cards).indexOf(id));
  const resolve=()=>call(zones.exports.resolveOrder,b.read(v=>({zone:v.get(pile),keys:v.get(cards).map((entity,key)=>({entity,key}))})));
  return sequence(forEach(b.read(v=>Array.from({length:v.input.padding??0})),()=>spawnEntity({definition:item,owner:null,scope:0})),b.assign(cards,[]),forEach([0,1,2,3,4],()=>sequence(b.assign(made,spawnEntity({definition:item,owner:null,scope:0})),b.assign(cards,b.read(v=>[...v.get(cards),v.get(made)])))),
    b.assign(pile,spawnEntity({definition:zone,owner:null,scope:0})),
    forEach(b.read(v=>v.input.order),index=>call(zones.exports.move,{entity:b.read(v=>v.get(cards)[v.get(index)]!),from:null,to:pile,index:b.read(v=>v.query(zones.exports.members,v.get(pile)).length)})),
    call(zones.exports.conceal,{zone:pile,blocks:[b.read(v=>[...v.query(zones.exports.members,v.get(pile))])],unsupported:false}),
    call(zones.exports.move,{entity:b.read(v=>v.get(cards)[3]!),from:null,to:pile,index:b.read(v=>v.input.middle?1:0)}),
    when(b.read(v=>v.input.random===true),call(zones.exports.obscure,{zone:pile,entity:b.read(v=>v.get(cards)[3]!)})),
    call(zones.exports.move,{entity:b.read(v=>v.get(cards)[4]!),from:null,to:pile,index:b.read(v=>v.query(zones.exports.members,v.get(pile)).length)}),
    when(b.read(v=>v.input.reveal>0),call(zones.exports.reveal,{zone:pile,count:b.read(v=>v.input.reveal),keys:b.read(v=>v.get(cards).map((entity,key)=>({entity,key})))})),
    call(pause,[]),resolve(),call(pause,b.read(logical)),resolve(),b.return(b.read(logical)));
});
const definition=linkRules<{},z.infer<typeof setup>,{pause:{input:number[];output:null}},number[]>({id:'sts/ordering-probability',schemas:{setup,result:z.array(z.number()),ports:{pause:{input:z.array(z.number()),output:z.null()}}},initialize:()=>({}),entry,definitions:[entry,pause],modules:[items]});
function current(order:number[],reveal=0,middle=false,random=false,padding=0){
  const program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial({order,reveal,middle,random,padding})));
  assert.equal(machine.advance().kind,'call');return new ProbabilityCurrent(machine);
}
const entropy={word(){throw Error('Must enumerate');},check(){}};
test('production zone movements retain known top/bottom and probability children keep their selected order',()=>{
  const left=current([0,1,2]),right=current([2,0,1]),before=left.machine.storage.export(left.machine.root);
  const a=nextProbability(left,null,{maximum:8,entropy}),b=nextProbability(right,null,{maximum:8,entropy});
  try{
    assert.equal(a.representation,'exact');assert.equal(a.outcomes.length,6);
    const stops=a.outcomes.map(o=>o.current.inspect());assert.deepEqual(stops,b.outcomes.map(o=>o.current.inspect()));
    for(const o of a.outcomes){
      assert.equal(o.probability,1/6);const stop=o.current.inspect();if(stop.kind!=='call')throw Error('Expected next IO');
      assert.equal(stop.call.input[0],3);assert.equal(stop.call.input.at(-1),4);
      const next=nextProbability(o.current,null,{maximum:8,entropy});
      try{assert.equal(next.outcomes.length,1);assert.deepEqual(next.outcomes[0]!.current.inspect(),{kind:'done',result:stop.call.input});}
      finally{for(const child of next.outcomes)child.current.close();}
    }
    assert.deepEqual(left.machine.storage.export(left.machine.root),before);
  }finally{for(const o of [...a.outcomes,...b.outcomes])o.current.close();left.close();right.close();}
});
test('production reveal fixes the observed top prefix and full disclosure makes order deterministic',()=>{
  for(const [count,expected] of [[2,2],[5,1]] as const){
    const source=current([2,0,1],count),result=nextProbability(source,null,{maximum:8,entropy});
    try{assert.equal(result.outcomes.length,expected);for(const o of result.outcomes){const stop=o.current.inspect();if(stop.kind!=='call')throw Error('Expected IO');assert.deepEqual(stop.call.input.slice(-2),[1,4]);}}
    finally{for(const o of result.outcomes)o.current.close();source.close();}
  }
});
function sampledEntropy(){let cursor={state:7381,position:0};return{check(){},word(){const next=searchEntropyWord(cursor);cursor=next.random;return next.value;}};}
for(const random of [false,true])test(`conditional insertion has production probability successors; random=${random}`,()=>{
  const left=current([0,1,2],0,true,random),right=current([2,0,1],0,random?false:true,random);
  const before=left.machine.storage.export(left.machine.root);
  const a=nextProbability(left,null,{maximum:8,entropy:sampledEntropy()}),b=nextProbability(right,null,{maximum:8,entropy:sampledEntropy()});
  try{
    assert.equal(a.representation,'particles');assert.deepEqual(a.outcomes.map(o=>o.current.inspect()),b.outcomes.map(o=>o.current.inspect()));
    const restored=new ProbabilityCurrent(new CardMachine(left.machine.program,privateCardGraph(before)));
    try{const next=nextProbability(restored,null,{maximum:8,entropy:sampledEntropy()});try{assert.deepEqual(next.outcomes.map(o=>o.current.inspect()),a.outcomes.map(o=>o.current.inspect()));}finally{for(const child of next.outcomes)child.current.close();}}finally{restored.close();}
    for(const child of a.outcomes){const stop=child.current.inspect();if(stop.kind!=='call')throw Error('Expected successor');assert.equal(stop.call.input.at(-1),4);if(!random)assert.equal(stop.call.input[1],3);
      const next=nextProbability(child.current,null,{maximum:8,entropy});try{assert.equal(next.outcomes.length,1);assert.deepEqual(next.outcomes[0]!.current.inspect(),{kind:'done',result:stop.call.input});}finally{for(const o of next.outcomes)o.current.close();}
    }
    assert.deepEqual(left.machine.storage.export(left.machine.root),before);
    assert.deepEqual(left.machine.advance(null),{kind:'call',call:{port:'pause',input:[0,3,1,2,4]}});
  }finally{for(const o of [...a.outcomes,...b.outcomes])o.current.close();left.close();right.close();}
});

// Exhaust the small mathematical language only in tests. The production kernel
// samples the graph directly and never expands all card permutations.
function distribution(knowledge:OrderKnowledge){
  const language=knowledge.language??blockLanguage(knowledge.blocks),values=new Map<string,number>();
  function visit(node:number,remaining:number[][],order:number[],mass:number){
    const n=language.nodes[node]!;if(n.end){assert.ok(remaining.every(group=>group.length===0));const key=order.join(',');values.set(key,(values.get(key)??0)+mass*n.end);}
    for(const edge of n.edges){const group=remaining[edge.group]!;for(const id of group)visit(edge.to,remaining.map((members,at)=>at===edge.group?members.filter(member=>member!==id):members),[...order,id],mass*edge.weight/group.length);}
  }
  visit(language.root,knowledge.blocks.map(group=>[...group]),[],1);const total=[...values.values()].reduce((a,b)=>a+b,0);return new Map([...values].map(([key,p])=>[key,p/total]));
}
function closeMass(actual:Map<string,number>,expected:Map<string,number>){assert.deepEqual([...actual.keys()].sort(),[...expected.keys()].sort());for(const [key,mass]of actual)assert.ok(Math.abs(mass-expected.get(key)!)<1e-12,`${key}: ${mass} != ${expected.get(key)}`);}
function transformed(source:Map<string,number>,transform:(order:number[])=>number[]|null){const result=new Map<string,number>();for(const [key,p]of source){const next=transform(key.split(',').map(Number));if(next){const id=next.join(',');result.set(id,(result.get(id)??0)+p);}}const total=[...result.values()].reduce((a,b)=>a+b,0);return new Map([...result].map(([key,p])=>[key,p/total]));}
test('order graph retains exact marginal masses through middle insertion, removal and partial position disclosure',()=>{
  const original:OrderKnowledge={blocks:[[0,1,2]],resolved:false,unsupported:false},base=distribution(original);
  const inserted=insertOrdered(original,9,1),expected=transformed(base,order=>{order.splice(1,0,9);return order;});closeMass(distribution(inserted),expected);
  const removed=removeOrdered(inserted,0),without=transformed(expected,order=>order.filter(id=>id!==0));closeMass(distribution(removed),without);
  assert.ok(new Set([...without.values()].map(p=>p.toFixed(12))).size>1,'marginalized positions are not uniformly distributed');
  const observed=revealPositions(removed,[9,1,2],[1]);closeMass(distribution(observed),transformed(without,order=>order[1]===1?order:null));
  const top=revealOrdered(removed,[9,1,2],1);closeMass(distribution(top),transformed(without,order=>order.at(-1)===2?order:null));
  const appended=appendExchangeable(observed,[7,8]);const appendedMass=new Map<string,number>();for(const [key,p]of distribution(observed)){appendedMass.set(key+',7,8',p/2);appendedMass.set(key+',8,7',p/2);}closeMass(distribution(appended),appendedMass);
});
test('hidden random insertion marginalizes its actual index while retaining prior relative constraints',()=>{
  const original:OrderKnowledge={blocks:[[0,1],[8]],resolved:false,unsupported:false};
  const a=randomInsertion(insertOrdered(original,9,0),9),b=randomInsertion(insertOrdered(original,9,1),9);closeMass(distribution(a),distribution(b));
  const expected=new Map<string,number>();for(const [key,p]of distribution(original))for(let index=0;index<4;index++){const order=key.split(',').map(Number);order.splice(index,0,9);const id=order.join(',');expected.set(id,(expected.get(id)??0)+p/4);}closeMass(distribution(a),expected);
});

test('random insertion into one exchangeable group stays a uniform permutation',()=>{
  const original:OrderKnowledge={blocks:[[0,1,2]],resolved:false,unsupported:false};
  const after=randomInsertion(insertOrdered(original,9,1),9),mass=distribution(after);
  assert.equal(mass.size,24);for(const value of mass.values())assert.ok(Math.abs(value-1/24)<1e-12);
  let large:OrderKnowledge={blocks:[Array.from({length:40},(_,i)=>i)],resolved:false,unsupported:false};
  for(let i=40;i<60;i++)large=randomInsertion(insertOrdered(large,i,10),i);
  assert.equal(orderSize(large.blocks),orderSize([Array.from({length:60},(_,i)=>i)]));assert.equal(large.language,undefined);
});

test('equivalent hidden insertion positions canonicalize to the same sampled conditional order',()=>{
  const prior:OrderKnowledge={blocks:[[0,1],[8]],resolved:false,unsupported:false},keys=new Map([0,1,8,9].map(id=>[id,id]));
  const left=canonicalOrder(randomInsertion(insertOrdered(prior,9,0),9),keys),right=canonicalOrder(randomInsertion(insertOrdered(prior,9,1),9),keys);
  assert.deepEqual(left,right);const a=sampledEntropy(),b=sampledEntropy();for(let i=0;i<32;i++)assert.deepEqual(sampleLanguage(left.language!,left.blocks,a),sampleLanguage(right.language!,right.blocks,b));
});

test('observed topmost match conditions the remaining order instead of uniformly deleting its identity',()=>{
  const original:OrderKnowledge={blocks:[[0,1,2]],resolved:false,unsupported:false};
  const conditioned=observeLastMatch(original,[0,1],0),expected=transformed(distribution(original),order=>order.filter(id=>id===0||id===1).at(-1)===0?order:null);
  closeMass(distribution(conditioned),expected);
  const remaining=distribution(removeOrdered(conditioned,0));closeMass(remaining,new Map([['1,2',2/3],['2,1',1/3]]));
  assert.deepEqual(observeLastMatch(original,[],null),original);assert.throws(()=>observeLastMatch(original,[0],null),/Missing selected/);
  assert.throws(()=>observeLastMatch(original,[0],1),/does not match/);
});
test('topmost-match conditioning composes with known middle positions and earlier observations',()=>{
  const base:OrderKnowledge={blocks:[[0,1,2,3]],resolved:false,unsupported:false};
  const prior=insertOrdered(base,8,2),matches=[0,2,8],law=distribution(prior);
  for(const selected of matches){const expected=transformed(law,order=>order.filter(id=>matches.includes(id)).at(-1)===selected?order:null);if(!expected.size)continue;
    const observed=observeLastMatch(prior,matches,selected);closeMass(distribution(observed),expected);
    closeMass(distribution(removeOrdered(observed,selected)),transformed(expected,order=>order.filter(id=>id!==selected)));
  }
  const first=observeLastMatch(base,[0,1],0),second=observeLastMatch(first,[1,2],2);
  closeMass(distribution(second),transformed(distribution(first),order=>order.filter(id=>id===1||id===2).at(-1)===2?order:null));
});


test('top-member marginals and successive reveals preserve the complete conditional order law',()=>{
  const plain:OrderKnowledge={blocks:[[0,1,2]],resolved:false,unsupported:false};
  const laws=[plain,insertOrdered(plain,9,1),removeOrdered(insertOrdered(plain,9,1),0),observeLastMatch(plain,[0,1],0),randomInsertion(insertOrdered({blocks:[[0,1],[8]],resolved:false,unsupported:false},9,0),9)];
  for(const law of laws){
    const original=structuredClone(law),expected=distribution(law),top=new Map<string,number>();
    for(const [key,p]of expected){const selected=key.split(',').at(-1)!;top.set(selected,(top.get(selected)??0)+p);}
    closeMass(new Map(topOrderChoices(law).map(row=>[String(row.entity),row.probability])),top);
    function walk(current:OrderKnowledge,suffix:number[],mass:number,result:Map<string,number>){
      if(!current.blocks.flat().length){const key=suffix.join(',');result.set(key,(result.get(key)??0)+mass);return;}
      for(const [index,choice]of topOrderChoices(current).entries()){
        const representative=topOrderAt(current,BigInt(index));assert.equal(representative.at(-1),choice.entity);
        const revealed=revealOrdered(current,representative,1);assert.equal(revealed.resolved,false);
        walk(removeOrdered(revealed,choice.entity),[choice.entity,...suffix],mass*choice.probability,result);
      }
    }
    const actual=new Map<string,number>();walk(law,[],1,actual);closeMass(actual,expected);assert.deepEqual(law,original);
  }
});

test('one revealed member of a large order does not sample or fix the remaining permutation',()=>{
  const prior:OrderKnowledge={blocks:[Array.from({length:60},(_,i)=>i)],resolved:false,unsupported:false},choices=topOrderChoices(prior);
  assert.equal(choices.length,60);assert.ok(choices.every(row=>row.probability===1/60));
  const representative=topOrderAt(prior,37n),after=removeOrdered(revealOrdered(prior,representative,1),37);
  assert.equal(representative.at(-1),37);assert.equal(after.resolved,false);assert.equal(after.blocks.length,1);assert.equal(after.blocks[0]!.length,59);
  assert.equal(orderSize(after.blocks),orderSize([Array.from({length:59},(_,i)=>i)]));assert.equal(prior.blocks[0]!.length,60);
});


test('multiple revealed top members use their joint marginal and retain the exact remaining conditional order',()=>{
  const plain:OrderKnowledge={blocks:[[0,1,2]],resolved:false,unsupported:false};
  for(const law of [plain,insertOrdered(plain,9,1),removeOrdered(insertOrdered(plain,9,1),0),observeLastMatch(plain,[0,1],0)]){
    const before=structuredClone(law),joint=distribution(law),length=law.blocks.flat().length;
    for(let count=1;count<=length;count++){
      const choices=prefixOrderChoices(law,count,128);assert.ok(choices);
      const expected=new Map<string,number>();for(const [key,p]of joint){const top=key.split(',').slice(-count).reverse().join(',');expected.set(top,(expected.get(top)??0)+p);}
      closeMass(new Map(choices.map(row=>[row.top.join(','),row.probability])),expected);
      const recovered=new Map<string,number>();
      for(const choice of choices){
        const known=new Set(choice.top),carrier=[...law.blocks.flat().filter(id=>!known.has(id)),...choice.top.toReversed()];
        for(const [key,p]of distribution(revealOrdered(law,carrier,count)))recovered.set(key,(recovered.get(key)??0)+choice.probability*p);
      }
      closeMass(recovered,joint);
    }
    assert.deepEqual(law,before);
  }
});

test('a large multi-card reveal samples only its prefix, leaving the other factorial possibilities unresolved',()=>{
  const law:OrderKnowledge={blocks:[Array.from({length:60},(_,i)=>i)],resolved:false,unsupported:false};
  assert.equal(prefixOrderChoices(law,3),null);
  const representative=samplePrefixOrder(law,3,sampledEntropy()),revealed=revealOrdered(law,representative,3);
  assert.equal(new Set(representative).size,60);assert.equal(revealed.resolved,false);
  assert.equal(orderSize(revealed.blocks),orderSize([Array.from({length:57},(_,i)=>i)]));
  assert.equal(law.blocks[0]!.length,60);
});


test('public prefix proposals retain their exact mass and sample the complete complementary law',()=>{
  const plain:OrderKnowledge={blocks:[[0,1,2]],resolved:false,unsupported:false};
  for(const law of [plain,insertOrdered(plain,9,1),observeLastMatch(plain,[0,1],0)]){
    const before=structuredClone(law),joint=distribution(law),count=2,expected=new Map<string,number>();
    for(const [key,p]of joint){const top=key.split(',').slice(-count).reverse().join(',');expected.set(top,(expected.get(top)??0)+p);}
    for(const [proposal,mass]of expected){
      const sampled=new Map<string,number>(),entropy=sampledEntropy(),rounds=512;
      for(let iteration=0;iteration<rounds;iteration++){
        const partition=partitionPrefixOrder(law,count,proposal.split(',').map(Number),8,entropy);assert.ok(partition);
        assert.ok(Math.abs(partition.outcomes[0]!.probability-mass)<1e-12);
        assert.ok(Math.abs(partition.outcomes.reduce((sum,row)=>sum+row.probability,0)-1)<1e-12);
        for(const [index,row]of partition.outcomes.entries()){
          if(typeof row.coordinate==='bigint')throw Error('Expected original sampler value');
          const key=(row.coordinate.value as number[]).slice(-count).reverse().join(',');
          assert.equal(key===proposal,index===0,'complement never includes the proposed prefix');
          sampled.set(key,(sampled.get(key)??0)+row.probability/rounds);
        }
      }
      assert.deepEqual([...sampled.keys()].sort(),[...expected.keys()].sort());
      for(const [key,p]of expected)assert.ok(Math.abs(sampled.get(key)!-p)<.025,`${proposal}: ${key} mass`);
    }
    assert.deepEqual(law,before);
    assert.equal(partitionPrefixOrder(law,count,[999,0],8,sampledEntropy()),undefined,'unrelated public list does not restrict the order law');
    assert.equal(partitionPrefixOrder(law,count,[0,0],8,sampledEntropy()),undefined);
  }
});


test('original reveal publications use public member keys, ignoring hidden suffix order and entity allocation gaps',()=>{
  const left=current([0,1,2],2,false,false,0),right=current([1,0,2],2,false,false,11);
  try{
    const a=left.machine.takeProbabilityPublications(),b=right.machine.takeProbabilityPublications();
    assert.deepEqual(a,[{kind:'ordered-prefix',orderedMembers:[4,2]}]);assert.deepEqual(b,a);
    assert.deepEqual(left.machine.takeProbabilityPublications(),[],'publication is consumed once, not an executable record');
    const first=nextProbability(left,null,{maximum:8,entropy}),second=nextProbability(right,null,{maximum:8,entropy});
    try{assert.deepEqual(first.outcomes.map(row=>({p:row.probability,stop:row.current.inspect()})),second.outcomes.map(row=>({p:row.probability,stop:row.current.inspect()})));}
    finally{for(const row of [...first.outcomes,...second.outcomes])row.current.close();}
  }finally{left.close();right.close();}
});


test('a fresh appended shuffle preserves previously materialized correlations and the exact new suffix law',()=>{
  const old:OrderKnowledge={blocks:[[0,1,2]],resolved:true,unsupported:false};
  assert.throws(()=>appendExchangeable(old,[7,8]),/requires its current order/);
  const appended=appendExchangeable(old,[7,8],[2,0,1]);
  assert.equal(appended.resolved,false);closeMass(distribution(appended),new Map([['2,0,1,7,8',.5],['2,0,1,8,7',.5]]));
  assert.deepEqual(old,{blocks:[[0,1,2]],resolved:true,unsupported:false});
});
