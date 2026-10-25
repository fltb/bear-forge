import {massNumber,probabilityMass,addMass,multiplyMass,unitMass,zeroMass} from '../../../packages/card-engine/src/probability-mass.ts';
import {ProbabilityExpansion} from '../../../packages/runtime-card/src/probability-expansion.ts';
import {serialize,deserialize} from 'node:v8';
import {probabilityCursor,nextProbabilityCoordinate} from '../../../packages/card-engine/src/probability-cursor.ts';
import {topOrderMasses,afterTop} from '../src/rules/order-space.ts';
import {groupOrder,orderCoordinate} from '../src/rules/order-space.ts';
import {permutationAt,permutationCount} from '../../../packages/card-engine/src/probability.ts';
import test from 'node:test';
import {expandAll} from './probability-fixture.ts';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CardProgram,CardMachine,linkRules,ruleModules} from '@bear-forge/card-engine';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {ProbabilityCurrent} from '../../../packages/runtime-card/src/probability.ts';
import {blockLanguage} from '../src/rules/order-language.ts';
import {rules} from '../src/rules/execution.ts';
import {zones} from '../src/rules/zones.ts';
import {orderSize,orderAt,revealOrdered,revealPositions,insertOrdered,removeOrdered,randomInsertion,appendExchangeable,canonicalOrder,observeLastMatch,topOrderChoices,topOrderAt,type OrderKnowledge} from '../src/rules/order-space.ts';

test('stable grouping is the exact pushforward of all original shuffles and retains every suffix',()=>{
  const items=[0,1,2,3,4],groups=[[0,2],[1,3,4]],counts=new Map<string,number>();
  for(let c=0n;c<permutationCount(items.length);c++){
    const shuffled=permutationAt(items,c),expected=[...shuffled.filter(i=>i===0||i===2),...shuffled.filter(i=>i!==0&&i!==2)],order=groupOrder(shuffled,groups);
    assert.deepEqual(order,expected);const key=JSON.stringify(order);counts.set(key,(counts.get(key)??0)+1);
    assert.deepEqual(orderAt(groups,orderCoordinate(groups,order)),order);
  }
  assert.equal(counts.size,12);assert.ok([...counts.values()].every(count=>count===10));
  const rows=Array.from({length:Number(orderSize(groups))},(_,index)=>orderAt(groups,BigInt(index)));
  const matching=rows.filter(order=>JSON.stringify(order.slice(-2))==='[3,4]');
  assert.equal(matching.length,2);assert.equal(new Set(matching.map(order=>JSON.stringify(order.slice(0,2)))).size,2);
  const mass=probabilityMass(BigInt(matching.length),orderSize(groups));assert.deepEqual(mass,probabilityMass(1n,6n));
  assert.deepEqual(addMass(mass,probabilityMass(BigInt(rows.length-matching.length),orderSize(groups))),unitMass());
});

test('a large full-order law retains every unvisited coordinate and its conditional suffix',()=>{
  const blocks=[Array.from({length:10},(_,i)=>i)],size=orderSize(blocks);assert.equal(size,3628800n);
  let cursor=probabilityCursor({kind:'uniform',size}),visited=zeroMass();
  // Inspect three coordinates; this is not a completed search or a population.
  for(let index=0;index<3;index++){
    const next=nextProbabilityCoordinate(cursor)!;visited=addMass(visited,next.probability);cursor=next.cursor;
    assert.equal(orderCoordinate(blocks,orderAt(blocks,next.coordinate)),next.coordinate);
    cursor=deserialize(serialize(cursor));assert.deepEqual(addMass(visited,cursor.remaining),unitMass());
  }
  assert.equal(cursor.next,3n);assert.deepEqual(cursor.remaining,probabilityMass(size-3n,size));
  const known:OrderKnowledge={blocks,resolved:false,unsupported:false};
  const first=topOrderMasses(known).find(row=>row.entity===9)!,after=afterTop(known,9);
  const second=topOrderMasses(after).find(row=>row.entity===8)!;
  assert.deepEqual(multiplyMass(first.mass,second.mass),probabilityMass(1n,90n));
  assert.equal(orderSize(afterTop(after,8).blocks),40320n,'all eight factorial suffixes survive conditioning');
});

test('ordered exchangeable blocks enumerate only their legal permutations',()=>{
  const blocks=[[9],[0,1,2],[8],[3,4]],size=orderSize(blocks);
  assert.equal(size,12n);
  const values=Array.from({length:Number(size)},(_,i)=>orderAt(blocks,BigInt(i)));
  assert.equal(new Set(values.map(v=>JSON.stringify(v))).size,12);
  for(const value of values){assert.equal(value[0],9);assert.equal(value[4],8);assert.deepEqual(value.slice(1,4).sort(),[0,1,2]);assert.deepEqual(value.slice(5).sort(),[3,4]);}
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
    when(b.read(v=>v.input.random===true),call(zones.exports.obscure,{zone:pile,entity:b.read(v=>v.get(cards)[3]!),slots:4})),
    call(zones.exports.move,{entity:b.read(v=>v.get(cards)[4]!),from:null,to:pile,index:b.read(v=>v.query(zones.exports.members,v.get(pile)).length)}),
    when(b.read(v=>v.input.reveal>0),call(zones.exports.reveal,{zone:pile,count:b.read(v=>v.input.reveal),keys:b.read(v=>v.get(cards).map((entity,key)=>({entity,key})))})),
    call(pause,[]),resolve(),call(pause,b.read(logical)),resolve(),b.return(b.read(logical)));
});
const definition=linkRules<{},z.infer<typeof setup>,{pause:{input:number[];output:null}},number[]>({id:'sts/ordering-probability',schemas:{setup,result:z.array(z.number()),ports:{pause:{input:z.array(z.number()),output:z.null()}}},initialize:()=>({}),entry,definitions:[entry,pause],modules:[items]});
function current(order:number[],reveal=0,middle=false,random=false,padding=0){
  const program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial({order,reveal,middle,random,padding})));
  assert.equal(machine.advance().kind,'call');return new ProbabilityCurrent(machine);
}
test('production zone movements retain known top/bottom and probability children keep their selected order',()=>{
  const left=current([0,1,2]),right=current([2,0,1]),before=left.machine.storage.export(left.machine.root);
  const a=expandAll(left,null),b=expandAll(right,null);
  try{
    assert.equal(a.outcomes.length,6);
    const stops=a.outcomes.map(o=>o.current.inspect());assert.deepEqual(stops,b.outcomes.map(o=>o.current.inspect()));
    for(const o of a.outcomes){
      assert.deepEqual(o.mass,probabilityMass(1n,6n));const stop=o.current.inspect();if(stop.kind!=='call')throw Error('Expected next IO');
      assert.equal(stop.call.input[0],3);assert.equal(stop.call.input.at(-1),4);
      const next=expandAll(o.current,null);
      try{assert.equal(next.outcomes.length,1);assert.deepEqual(next.outcomes[0]!.current.inspect(),{kind:'done',result:stop.call.input});}
      finally{for(const child of next.outcomes)child.current.close();}
    }
    assert.deepEqual(left.machine.storage.export(left.machine.root),before);
  }finally{for(const o of [...a.outcomes,...b.outcomes])o.current.close();left.close();right.close();}
});
test('production reveal fixes the observed top prefix and full disclosure makes order deterministic',()=>{
  for(const [count,expected] of [[2,2],[5,1]] as const){
    const source=current([2,0,1],count),result=expandAll(source,null);
    try{assert.equal(result.outcomes.length,expected);for(const o of result.outcomes){const stop=o.current.inspect();if(stop.kind!=='call')throw Error('Expected IO');assert.deepEqual(stop.call.input.slice(-2),[1,4]);}}
    finally{for(const o of result.outcomes)o.current.close();source.close();}
  }
});
for(const random of [false,true])test(`conditional insertion has production probability successors; random=${random}`,()=>{
  const left=current([0,1,2],0,true,random),right=current([2,0,1],0,random?false:true,random);
  const before=left.machine.storage.export(left.machine.root);
  // Save the unconsumed action and replace its owner before any expansion.
  let pending=ProbabilityExpansion.from(left,null,null);
  pending.step();const saved=deserialize(serialize(pending.save()));pending.close();
  pending=ProbabilityExpansion.restore(left.machine.program,saved);
  const a:{outcomes:NonNullable<ReturnType<typeof pending.take>>[]}={outcomes:[]};
  const b=expandAll(right,null);
  try{
    while(!pending.complete){
      pending.step();const masses=pending.masses();assert.deepEqual(addMass(addMass(masses.pending,masses.ready),masses.transferred),unitMass());
      for(let row=pending.take();row;row=pending.take())a.outcomes.push(row);
    }
    for(let row=pending.take();row;row=pending.take())a.outcomes.push(row);
    assert.equal(a.outcomes.length,random?24:6);
    assert.deepEqual(a.outcomes.map(row=>({mass:row.mass,stop:row.current.inspect()})),b.outcomes.map(row=>({mass:row.mass,stop:row.current.inspect()})));
    assert.deepEqual(a.outcomes.reduce((sum,row)=>addMass(sum,row.mass),zeroMass()),unitMass());
    for(const child of a.outcomes){const stop=child.current.inspect();if(stop.kind!=='call')throw Error('Expected successor');assert.equal(stop.call.input.at(-1),4);if(!random)assert.equal(stop.call.input[1],3);
      const next=expandAll(child.current,null);try{assert.equal(next.outcomes.length,1);assert.deepEqual(next.outcomes[0]!.current.inspect(),{kind:'done',result:stop.call.input});}finally{for(const o of next.outcomes)o.current.close();}
    }
    assert.deepEqual(left.machine.storage.export(left.machine.root),before);
    assert.deepEqual(left.machine.advance(null),{kind:'call',call:{port:'pause',input:[0,3,1,2,4]}});
  }finally{pending.close();for(const o of [...a.outcomes,...b.outcomes])o.current.close();left.close();right.close();}
});

// Exhaust the small mathematical language only in tests. The production kernel
// retains complete-order coordinates or conditional top choices and their law.
function distribution(knowledge:OrderKnowledge){
  const language=knowledge.language??blockLanguage(knowledge.blocks),values=new Map<string,number>();
  function visit(node:number,remaining:number[][],order:number[],mass:number){
    const n=language.nodes[node]!;if(n.end.numerator>0n){assert.ok(remaining.every(group=>group.length===0));const key=order.join(',');values.set(key,(values.get(key)??0)+mass*massNumber(n.end));}
    for(const edge of n.edges){const group=remaining[edge.group]!;for(const id of group)visit(edge.to,remaining.map((members,at)=>at===edge.group?members.filter(member=>member!==id):members),[...order,id],mass*massNumber(edge.weight)/group.length);}
  }
  visit(language.root,knowledge.blocks.map(group=>[...group]),[],1);const total=[...values.values()].reduce((a,b)=>a+b,0);return new Map([...values].map(([key,p])=>[key,p/total]));
}
test('production order expansion retains all 24 permutations and resumes inside the sorting operation',()=>{
  const source=current([0,1,2],0,false,true),before=source.machine.storage.export(source.machine.root),outcomes=new Map<string,ReturnType<typeof probabilityMass>>();
  let expansion=ProbabilityExpansion.from(source,null,null),steps=0;
  try{
    while(!expansion.complete){
      expansion.step();
      const masses=expansion.masses();assert.deepEqual(addMass(addMass(masses.pending,masses.ready),masses.transferred),unitMass());
      for(;;){const row=expansion.take();if(!row)break;
        try{const stop=row.current.inspect();if(stop.kind!=='call')throw Error('Expected original pause');
          assert.equal(stop.call.input.at(-1),4);const key=stop.call.input.join(',');assert.equal(outcomes.has(key),false);outcomes.set(key,row.mass);
        }finally{row.current.close();}
      }
      if(++steps%7===0){const saved=deserialize(serialize(expansion.save()));expansion.close();expansion=ProbabilityExpansion.restore(source.machine.program,saved);}
    }
    assert.equal(outcomes.size,24);for(const mass of outcomes.values())assert.deepEqual(mass,probabilityMass(1n,24n));
    assert.deepEqual(source.machine.storage.export(source.machine.root),before);
  }finally{expansion.close();source.close();}
});

function fullOrderCurrent(groups:number[][]){
  const setup=z.array(z.array(z.number())),entry=defineEffect<number[][],number[]>(b=>{
    const cards=b.local<number[]>(),pile=b.local<number>(),made=b.local<number>();
    const logical=(v:rules.ReadView<number[][]>)=>v.query(zones.exports.members,v.get(pile)).map(id=>v.get(cards).indexOf(id));
    const resolve=()=>call(zones.exports.resolveOrder,b.read(v=>({zone:v.get(pile),keys:v.get(cards).map((entity,key)=>({entity,key}))})));
    return sequence(b.assign(cards,[]),forEach(b.read(v=>v.input.flat()),()=>sequence(
      b.assign(made,spawnEntity({definition:item,owner:null,scope:0})),b.assign(cards,b.read(v=>[...v.get(cards),v.get(made)])))),
      b.assign(pile,spawnEntity({definition:zone,owner:null,scope:0})),
      forEach(b.read(v=>v.input.flat()),index=>call(zones.exports.move,{entity:b.read(v=>v.get(cards)[v.get(index)]!),from:null,to:pile,index:b.read(v=>v.query(zones.exports.members,v.get(pile)).length)})),
      call(zones.exports.conceal,{zone:pile,blocks:b.read(v=>v.input.map(group=>group.map(index=>v.get(cards)[index]!))),unsupported:false}),
      call(pause,[]),resolve(),call(pause,b.read(logical)),resolve(),b.return(b.read(logical)));
  });
  const definition=linkRules<{},number[][],{pause:{input:number[];output:null}},number[]>({id:'sts/full-block-order',schemas:{setup,result:z.array(z.number()),ports:{pause:{input:z.array(z.number()),output:z.null()}}},initialize:()=>({}),entry,definitions:[entry,pause],modules:[items]});
  const program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial(groups)));
  assert.equal(machine.advance().kind,'call');return new ProbabilityCurrent(machine);
}

test('original full ordering uses one exact product coordinate and preserves every block permutation through cold restore',()=>{
  const source=fullOrderCurrent([[0,1],[2,3,4]]),before=source.machine.storage.export(source.machine.root);
  const expected=new Set<string>();
  for(let a=0n;a<2n;a++)for(let b=0n;b<6n;b++)expected.add([...permutationAt([0,1],a),...permutationAt([2,3,4],b)].join(','));
  let expansion=ProbabilityExpansion.from(source,null,null),found=false;const actual=new Set<string>(),initialize=CardProgram.prototype.initial;
  try{
    CardProgram.prototype.initial=()=>{throw Error('Full ordering must resume its Context');};
    while(!expansion.complete){
      expansion.step();
      const saved=deserialize(serialize(expansion.savePacked())) as ReturnType<typeof expansion.savePacked>;
      found ||= saved.pending.some(row=>row.phase==='chance'&&row.cursor.space.kind==='uniform'&&row.cursor.space.size===12n);
      expansion.close();expansion=ProbabilityExpansion.restore(source.machine.program,saved);
      for(let row=expansion.take();row;row=expansion.take())try{
        const stop=row.current.inspect();if(stop.kind!=='call')throw Error('Expected full order');
        assert.deepEqual(row.mass,probabilityMass(1n,12n));assert.equal(actual.has(stop.call.input.join(',')),false);actual.add(stop.call.input.join(','));
        const next=expandAll(row.current,null);
        try{assert.equal(next.outcomes.length,1);assert.deepEqual(next.outcomes[0]!.current.inspect(),{kind:'done',result:stop.call.input});}
        finally{for(const child of next.outcomes)child.current.close();}
      }finally{row.current.close();}
    }
    assert.equal(found,true);assert.deepEqual(actual,expected);assert.deepEqual(expansion.masses().transferred,unitMass());
    assert.equal(expansion.transitionStats().sources,1);assert.deepEqual(source.machine.storage.export(source.machine.root),before);
  }finally{CardProgram.prototype.initial=initialize;expansion.close();source.close();}
});

test('original large full ordering keeps its factorial complement behind the same cursor',()=>{
  const source=fullOrderCurrent([Array.from({length:10},(_,i)=>i)]),size=permutationCount(10),before=source.machine.storage.export(source.machine.root);
  let expansion=ProbabilityExpansion.from(source,null,null),delivered=0,found=false;const seen=new Set<string>();
  try{
    // Inspect three delivered orders, retaining the entire remaining law.
    while(delivered<3){
      expansion.step();const saved=deserialize(serialize(expansion.savePacked())) as ReturnType<typeof expansion.savePacked>;
      found ||= saved.pending.some(row=>row.phase==='chance'&&row.cursor.space.kind==='uniform'&&row.cursor.space.size===size);
      expansion.close();expansion=ProbabilityExpansion.restore(source.machine.program,saved);
      for(let row=expansion.take();row;row=expansion.take())try{
        const stop=row.current.inspect();if(stop.kind!=='call')throw Error('Expected full order');
        assert.deepEqual([...stop.call.input].sort((a,b)=>a-b),Array.from({length:10},(_,i)=>i));
        const key=stop.call.input.join(',');assert.equal(seen.has(key),false);seen.add(key);delivered++;
        assert.deepEqual(row.mass,probabilityMass(1n,size));
      }finally{row.current.close();}
    }
    assert.equal(found,true);assert.equal(expansion.complete,false);assert.equal(expansion.transitionStats().sources,1);
    assert.deepEqual(expansion.masses(),{pending:probabilityMass(size-3n,size),ready:zeroMass(),transferred:probabilityMass(3n,size)});
    assert.deepEqual(source.machine.storage.export(source.machine.root),before);
  }finally{expansion.close();source.close();}
});

test('conditional order selection preserves exact original permutation multiplicities',()=>{
  const knowledge=removeOrdered(insertOrdered({blocks:[[0,1,2]],resolved:false,unsupported:false},9,1),0);
  // Enumerate the six original elementary orders as an independent count.
  const counts=new Map<string,bigint>();
  for(let c=0n;c<6n;c++){const order=permutationAt([0,1,2],c);order.splice(1,0,9);const key=order.filter(id=>id!==0).join(',');counts.set(key,(counts.get(key)??0n)+1n);}
  const actual=new Map<string,ReturnType<typeof probabilityMass>>();
  function visit(value:OrderKnowledge,top:number[],mass:ReturnType<typeof probabilityMass>){
    if(value.blocks.every(block=>block.length===0)){actual.set(top.toReversed().join(','),mass);return;}
    for(const choice of topOrderMasses(value))visit(afterTop(value,choice.entity),[...top,choice.entity],multiplyMass(mass,choice.mass));
  }
  visit(knowledge,[],unitMass());assert.deepEqual([...actual.keys()].sort(),[...counts.keys()].sort());
  for(const [key,count]of counts)assert.deepEqual(actual.get(key),probabilityMass(count,6n));
});
test('order language retains positive probability smaller than the numeric range',()=>{
  const tiny=probabilityMass(1n,1n<<1100n),rest=probabilityMass((1n<<1100n)-1n,1n<<1100n);
  const knowledge:OrderKnowledge={blocks:[[1],[2]],resolved:false,unsupported:false,language:{root:3,nodes:[
    {end:unitMass(),edges:[]},
    {end:zeroMass(),edges:[{group:1,to:0,weight:unitMass()}]},
    {end:zeroMass(),edges:[{group:0,to:0,weight:unitMass()}]},
    {end:zeroMass(),edges:[{group:0,to:1,weight:tiny},{group:1,to:2,weight:rest}]},
  ]}};
  const choices=topOrderMasses(knowledge);assert.deepEqual(choices,[{entity:1,mass:rest},{entity:2,mass:tiny}]);
  const conditional=afterTop(knowledge,2);assert.deepEqual(topOrderMasses(conditional),[{entity:1,mass:unitMass()}]);
});
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
  const a=randomInsertion(insertOrdered(original,9,0),9,4),b=randomInsertion(insertOrdered(original,9,1),9,4);closeMass(distribution(a),distribution(b));
  const expected=new Map<string,number>();for(const [key,p]of distribution(original))for(let index=0;index<4;index++){const order=key.split(',').map(Number);order.splice(index,0,9);const id=order.join(',');expected.set(id,(expected.get(id)??0)+p/4);}closeMass(distribution(a),expected);
});

test('random insertion into one exchangeable group stays a uniform permutation',()=>{
  const original:OrderKnowledge={blocks:[[0,1,2]],resolved:false,unsupported:false};
  const after=randomInsertion(insertOrdered(original,9,1),9,4),mass=distribution(after);
  assert.equal(mass.size,24);for(const value of mass.values())assert.ok(Math.abs(value-1/24)<1e-12);
  let large:OrderKnowledge={blocks:[Array.from({length:40},(_,i)=>i)],resolved:false,unsupported:false};
  for(let i=40;i<60;i++)large=randomInsertion(insertOrdered(large,i,10),i,i+1);
  assert.equal(orderSize(large.blocks),orderSize([Array.from({length:60},(_,i)=>i)]));assert.equal(large.language,undefined);
});

test('a restricted insertion law retains the original slots instead of inventing the top gap',()=>{
  for(const blocks of [[[0,1,2]],[[0,1],[2]]]){
    const original:OrderKnowledge={blocks,resolved:false,unsupported:false};
    for(const slots of [1,2,3]){
      const actual=randomInsertion(insertOrdered(original,9,0),9,slots),expected=new Map<string,number>();
      for(const [key,p]of distribution(original))for(let index=0;index<slots;index++){
        const order=key.split(',').map(Number);order.splice(index,0,9);const id=order.join(',');
        expected.set(id,(expected.get(id)??0)+p/slots);
      }
      closeMass(distribution(actual),expected);
      assert.ok([...expected.keys()].every(key=>!key.endsWith(',9')));
      const tops=topOrderMasses(actual);assert.ok(tops.every(row=>row.entity!==9));
      assert.deepEqual(tops.reduce((sum,row)=>addMass(sum,row.mass),zeroMass()),unitMass());
    }
  }
});

test('equivalent hidden insertion positions canonicalize to the same complete conditional law',()=>{
  const prior:OrderKnowledge={blocks:[[0,1],[8]],resolved:false,unsupported:false},keys=new Map([0,1,8,9].map(id=>[id,id]));
  const left=canonicalOrder(randomInsertion(insertOrdered(prior,9,0),9,4),keys),right=canonicalOrder(randomInsertion(insertOrdered(prior,9,1),9,4),keys);
  assert.deepEqual(left,right);assert.deepEqual(distribution(left),distribution(right));
});

test('observed topmost match conditions the remaining order instead of uniformly deleting its identity',()=>{
  const original:OrderKnowledge={blocks:[[0,1,2]],resolved:false,unsupported:false};
  const conditioned=observeLastMatch(original,[0,1],0),expected=transformed(distribution(original),order=>order.filter(id=>id===0||id===1).at(-1)===0?order:null);
  closeMass(distribution(conditioned),expected);
  const remaining=distribution(removeOrdered(conditioned,0));closeMass(remaining,new Map([['1,2',2/3],['2,1',1/3]]));
  assert.deepEqual(observeLastMatch(original,[],null),original);
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
  const laws=[plain,insertOrdered(plain,9,1),removeOrdered(insertOrdered(plain,9,1),0),observeLastMatch(plain,[0,1],0),randomInsertion(insertOrdered({blocks:[[0,1],[8]],resolved:false,unsupported:false},9,0),9,4)];
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


function prefixMasses(law:OrderKnowledge,count:number){
  const result:{top:number[];mass:ReturnType<typeof probabilityMass>}[]=[];
  function visit(current:OrderKnowledge,top:number[],mass:ReturnType<typeof probabilityMass>){
    if(top.length===count){result.push({top,mass});return;}
    for(const row of topOrderMasses(current))visit(afterTop(current,row.entity),[...top,row.entity],multiplyMass(mass,row.mass));
  }
  visit(law,[],unitMass());assert.deepEqual(result.reduce((sum,row)=>addMass(sum,row.mass),zeroMass()),unitMass());return result;
}

test('multiple revealed top members use their joint marginal and retain the exact remaining conditional order',()=>{
  const plain:OrderKnowledge={blocks:[[0,1,2]],resolved:false,unsupported:false};
  for(const law of [plain,insertOrdered(plain,9,1),removeOrdered(insertOrdered(plain,9,1),0),observeLastMatch(plain,[0,1],0)]){
    const before=structuredClone(law),joint=distribution(law),length=law.blocks.flat().length;
    for(let count=1;count<=length;count++){
      const choices=prefixMasses(law,count);
      const expected=new Map<string,number>();for(const [key,p]of joint){const top=key.split(',').slice(-count).reverse().join(',');expected.set(top,(expected.get(top)??0)+p);}
      closeMass(new Map(choices.map(row=>[row.top.join(','),massNumber(row.mass)])),expected);
      const recovered=new Map<string,number>();
      for(const choice of choices){
        const known=new Set(choice.top),carrier=[...law.blocks.flat().filter(id=>!known.has(id)),...choice.top.toReversed()];
        for(const [key,p]of distribution(revealOrdered(law,carrier,count)))recovered.set(key,(recovered.get(key)??0)+massNumber(choice.mass)*p);
      }
      closeMass(recovered,joint);
    }
    assert.deepEqual(law,before);
  }
});

test('a large reveal retains each conditional choice and every remaining factorial suffix',()=>{
  const law:OrderKnowledge={blocks:[Array.from({length:60},(_,i)=>i)],resolved:false,unsupported:false};
  let remaining=law,mass=unitMass();const top=[37,18,9];
  for(const [index,entity]of top.entries()){
    const choices=topOrderMasses(remaining);assert.equal(choices.length,60-index);
    assert.ok(choices.every(row=>row.mass.numerator===1n&&row.mass.denominator===BigInt(60-index)));
    const selected=choices.find(row=>row.entity===entity)!;mass=multiplyMass(mass,selected.mass);remaining=afterTop(remaining,entity);
  }
  assert.deepEqual(mass,probabilityMass(1n,60n*59n*58n));assert.equal(remaining.resolved,false);
  assert.equal(orderSize(remaining.blocks),permutationCount(57));assert.equal(law.blocks[0]!.length,60);
});

test('each observed prefix partitions the full law with exact mass and an intact complement',()=>{
  const plain:OrderKnowledge={blocks:[[0,1,2]],resolved:false,unsupported:false};
  for(const law of [plain,insertOrdered(plain,9,1),observeLastMatch(plain,[0,1],0)]){
    const before=structuredClone(law),choices=prefixMasses(law,2);
    for(const choice of choices){
      const complement=choices.filter(row=>row!==choice).reduce((mass,row)=>addMass(mass,row.mass),zeroMass());
      assert.deepEqual(addMass(choice.mass,complement),unitMass());
      const remaining=choice.top.reduce((current,entity)=>afterTop(current,entity),law);
      assert.ok(remaining.blocks.flat().every(entity=>!choice.top.includes(entity)));
      assert.deepEqual(topOrderMasses(remaining).reduce((mass,row)=>addMass(mass,row.mass),zeroMass()),unitMass());
    }
    assert.deepEqual(law,before);
  }
});

test('original reveal publications use public member keys, ignoring hidden suffix order and entity allocation gaps',()=>{
  const left=current([0,1,2],2,false,false,0),right=current([1,0,2],2,false,false,11);
  try{
    const a=left.machine.takeProbabilityPublications(),b=right.machine.takeProbabilityPublications();
    assert.deepEqual(a,[{kind:'ordered-prefix',orderedMembers:[4,2]}]);assert.deepEqual(b,a);
    assert.deepEqual(left.machine.takeProbabilityPublications(),[],'publication is consumed once, not an executable record');
    const first=expandAll(left,null),second=expandAll(right,null);
    try{assert.deepEqual(first.outcomes.map(row=>({mass:row.mass,stop:row.current.inspect()})),second.outcomes.map(row=>({mass:row.mass,stop:row.current.inspect()})));}
    finally{for(const row of [...first.outcomes,...second.outcomes])row.current.close();}
  }finally{left.close();right.close();}
});


test('a fresh appended shuffle preserves previously materialized correlations and the exact new suffix law',()=>{
  const old:OrderKnowledge={blocks:[[0,1,2]],resolved:true,unsupported:false};
  const appended=appendExchangeable(old,[7,8],[2,0,1]);
  assert.equal(appended.resolved,false);closeMass(distribution(appended),new Map([['2,0,1,7,8',.5],['2,0,1,8,7',.5]]));
  assert.deepEqual(old,{blocks:[[0,1,2]],resolved:true,unsupported:false});
});
