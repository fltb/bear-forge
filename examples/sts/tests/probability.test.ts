import {adventureDraws} from '../src/content/rewards/draws.ts';
import test from 'node:test';
import {expandAll,visitAll} from './probability-fixture.ts';
import {ProbabilityExpansion} from '../../../packages/runtime-card/src/probability-expansion.ts';
import {probabilityCursor,nextProbabilityCoordinate} from '../../../packages/card-engine/src/probability-cursor.ts';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CardProgram,CardMachine,linkRules,ruleModules} from '@bear-forge/card-engine';
import {createCardLoader} from '@bear-forge/runtime-card';
import {createGameBinder} from '@bear-forge/game-host';
import {forkGameCurrent} from '../../../packages/game-host/src/current.ts';
import {ProbabilityCurrent,takeProbabilityCurrent} from '../../../packages/runtime-card/src/probability.ts';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {permutationAt} from '../../../packages/card-engine/src/probability.ts';
import {probabilityMass,addMass,divideMass,unitMass,zeroMass} from '../../../packages/card-engine/src/probability-mass.ts';
import {rules} from '../src/rules/execution.ts';
import {random} from '../src/rules/random.ts';
import {randomState,randomInt,randomBoolean,randomLong,randomFloat,javaShuffle,rngView} from '../src/rng.ts';
import {randomViewSchema} from '../src/rules/random.schemas.ts';
import {combatContentDefinition} from './combat-content-fixture.ts';
import {encounterId,potionId} from '../src/identifiers.ts';
import {describeAction} from '../src/presentation.ts';
import {observe,contract} from '../src/contract.ts';
import type {Ports,Frame} from '../src/game.schemas.ts';
import {inspectRuleQuery} from '../../../packages/card-engine/src/rules-inspection.ts';
import {stateOf} from '../../../packages/card-engine/src/rules-module-internal.ts';
import {adventures} from '../src/rules/adventures.ts';
import {combatSessions} from '../src/rules/combat-sessions.ts';
import {battles} from '../src/rules/battles.ts';
import {cardPiles} from '../src/rules/card-piles.ts';
import {zones} from '../src/rules/zones.ts';
import {cardInstances} from '../src/rules/card-instances.ts';
import {resources} from '../src/rules/resources.ts';
import {basicCards} from '../src/content/characters/ironclad/cards/basic.ts';
import {actionQueue} from '../src/rules/combat-actions.ts';

const {defineEffect,defineEntity,spawnEntity,sequence,call,query}=rules;
const begin=ruleModules.portEffect<null,null>('begin');
const stream=defineEntity(random.exports.stream,undefined);
const output=z.object({integer:z.number(),chance:z.boolean(),order:z.array(z.number()),float:z.number(),long:z.bigint(),state:randomViewSchema});
type Result=z.infer<typeof output>;
const entry=defineEffect<string,Result>(b=>{
  const rng=b.local<number>(),integer=b.local<number>(),chance=b.local<boolean>(),order=b.local<readonly number[]>(),float=b.local<number>(),long=b.local<bigint>();
  return sequence(b.assign(rng,spawnEntity({definition:stream,owner:null,scope:0,setup:b.read(v=>BigInt(v.input))})),
    call(begin,null),b.assign(integer,call(random.exports.int,{stream:rng,start:-1,end:1})),
    b.assign(chance,call(random.exports.chance,{stream:rng,chance:.25})),
    b.assign(order,random.exports.shuffle({stream:rng,items:[0,1,2]})),
    b.assign(float,call(random.exports.float,{stream:rng})),b.assign(long,call(random.exports.long,{stream:rng})),
    b.return({integer,chance,order:b.read(v=>[...v.get(order)]),float,long,state:query(random.exports.current,rng)}));
});
const definition=linkRules({id:'sts/probability-primitives',schemas:{setup:z.string(),result:output,ports:{begin:{input:z.null(),output:z.null()}}},initialize:()=>({}),entry,definitions:[entry,begin],modules:[random]});
function source(seed:string){
  const program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial(seed)));
  assert.equal(machine.advance().kind,'call');return new ProbabilityCurrent(machine);
}
test('normal execution retains the original pseudorandom numbers and stream writes',()=>{
  const current=source('130');
  try{
    const rng=randomState(130n),integer=randomInt(rng,-1,1),chance=randomBoolean(rng,.25),order=[0,1,2];javaShuffle(order,randomLong(rng));
    const float=randomFloat(rng),long=randomLong(rng);
    assert.deepEqual(current.machine.advance(null),{kind:'done',result:{integer,chance,order,float,long,state:rngView(rng)}});
  }finally{current.close();}
});
test('probability execution uses the same random atoms but future coordinates do not depend on real RNG seeds',()=>{
  const actual=source('130'),other=source('999');
  const before=actual.machine.storage.export(actual.machine.root);
  const run=(parent:ReturnType<typeof source>)=>{
    const current=parent.fork();
    try{
      assert.deepEqual(current.advance(null),{kind:'chance',space:{kind:'uniform',size:3n}});
      const chance=current.advance(2n);assert.deepEqual(chance,{kind:'chance',space:{kind:'rational',weights:[probabilityMass(3n,4n),probabilityMass(1n,4n)]}});
      if(chance.kind!=='chance')throw Error('Expected chance');
      const cursor=probabilityCursor(chance.space),first=nextProbabilityCoordinate(cursor)!,second=nextProbabilityCoordinate(first.cursor)!;
      assert.deepEqual([first.probability,second.probability],[probabilityMass(3n,4n),probabilityMass(1n,4n)]);assert.deepEqual(second.cursor.remaining,zeroMass());
      assert.deepEqual(current.advance(1n),{kind:'chance',space:{kind:'uniform',size:6n}});
      assert.deepEqual(current.advance(4n),{kind:'chance',space:{kind:'uniform',size:1n<<24n}});
      assert.deepEqual(current.advance((1n<<24n)-1n),{kind:'chance',space:{kind:'uniform',size:1n<<64n}});
      const result=current.advance((1n<<64n)-1n);
      assert.equal(result.kind,'done');if(result.kind!=='done')throw Error('Expected result');return result.result;
    }finally{current.close();}
  };
  try{
    const left=run(actual),right=run(other);
    const expected={integer:1,chance:true,order:permutationAt([0,1,2],4n),float:1-2**-24,long:-1n};
    const {state:leftState,...leftValues}=left,{state:rightState,...rightValues}=right;
    assert.deepEqual(leftValues,expected);assert.deepEqual(rightValues,expected);
    assert.equal(leftState.counter,5);assert.equal(rightState.counter,5);
    assert.equal(leftState.seed0,rngView(randomState(130n)).seed0);
    assert.notEqual(leftState.seed0,rightState.seed0,'real stream data is retained, not masked');
    assert.deepEqual(actual.machine.storage.export(actual.machine.root),before);
  }finally{actual.close();other.close();}
});

const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
test('real attack potion probability branches continue original nested card selection without reinitialization',async()=>{
  const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false}).load(combatContentDefinition));
  const instance=unwrap(await loaded.core.start({seed:'130',encounter:encounterId.CULTIST,relics:[],potion:potionId.ATTACK_POTION,durable:false,elite:false,detailedEvents:true}));
  const game=unwrap(await createGameBinder().bind({instance,contract}));
  let busyChecked=false;
  unwrap(await game.bind({player:'0',onRequest:async()=>{await assert.rejects(forkGameCurrent(game),/game_busy/);busyChecked=true;return{kind:'pause'};},onEvent:async()=>({kind:'reply',value:null})}));
  unwrap(await game.run());
  assert.equal(busyChecked,true);
  await assert.rejects(forkGameCurrent({}),/no current Context/);
  const gameBefore=unwrap(await game.inspect()),initialize=CardProgram.prototype.initial;
  CardProgram.prototype.initial=function(){throw Error('Search must not initialize');};
  let root:ProbabilityCurrent<unknown,unknown,Ports,Frame>;
  try{root=await takeProbabilityCurrent<Ports,Frame>(await forkGameCurrent(game));}
  catch(error){CardProgram.prototype.initial=initialize;await game.close();throw error;}
  const machine=root.machine,program=machine.program,start=root.inspect();
  assert.equal(start.kind,'call');if(start.kind!=='call'||start.call.port!=='decision')throw Error('Expected current battle');
  const view=observe(start.call.input),action=start.call.input.actions.find(a=>describeAction(view,a.bits).kind==='drink-potion');
  assert.ok(action);
  const before=machine.storage.export(machine.root);
  const owned=new Set<typeof root>(),retained:ReturnType<typeof ProbabilityExpansion.from<unknown,unknown,Ports,Frame,null>>[]=[];
  const events={continueCall(stop:Extract<ReturnType<typeof root.inspect>,{kind:'call'}>,data:null){if(stop.call.port==='event')return{reply:contract.ports.event.receive(stop.call.input).output,data};}};
  function firstDecisions(source:typeof root,reply:unknown,count:number){
    const expansion=ProbabilityExpansion.from(source,reply,null,events);retained.push(expansion);
    const results:NonNullable<ReturnType<typeof expansion.take>>[]=[];
    // Inspect original nested menus while retaining every unvisited outcome.
    // This assertion window never claims to finish the action distribution.
    while(results.length<count){
      const next=expansion.take();if(next){owned.add(next.current);results.push(next);continue;}
      if(expansion.complete)break;expansion.step();
    }
    const mass=expansion.masses();assert.deepEqual(addMass(addMass(mass.pending,mass.ready),mass.transferred),unitMass());return results;
  }
  try{
    CardProgram.prototype.initial=function(){throw Error('Search must not initialize');};
    const results=firstDecisions(root,action,2);
    assert.equal(results.length,2);assert.ok(results.every(row=>row.mass.numerator>0n));
    const offered=new Set<string>();
    for(const {current} of results){
      assert.equal(current.machine.program,program);
      const stop=current.inspect();assert.equal(stop.kind,'call');
      if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected original nested decision');
      const nested=observe(stop.call.input);
      assert.ok(nested.battle?.select?.candidates?.length);offered.add(JSON.stringify(nested.battle.select.candidates));
      const selected=stop.call.input.actions[0]!;
      const children=firstDecisions(current,selected,1);assert.equal(children.length,1);
      for(const child of children){
        const after=child.current.inspect();
        if(after.kind!=='call'||after.call.port!=='decision')throw Error('Expected continuation after selection');
        assert.equal(observe(after.call.input).battle!.hand.length,view.battle!.hand.length+1);
        child.current.close();owned.delete(child.current);
      }
    }
    assert.ok(offered.size>1,'probability coordinates must affect the original offered cards');
    assert.deepEqual(machine.storage.export(machine.root),before);
    assert.deepEqual(unwrap(await game.inspect()),gameBefore);
  }finally{CardProgram.prototype.initial=initialize;for(const expansion of retained)expansion.close();for(const current of owned)current.close();root.close();unwrap(await game.close());}
  await assert.rejects(forkGameCurrent(game),/game_closed/);
});

test('real draw-potion futures ignore an unrevealed actual order while Frozen Eye preserves the revealed one',()=>{
  for(const visible of [false,true]){
    const make=(reverse:boolean)=>{
      const program=new CardProgram(combatContentDefinition),storage=privateCardGraph(program.initial({seed:'130',encounter:encounterId.CULTIST,relics:visible?['FROZEN_EYE']:[],potion:potionId.SWIFT_POTION,durable:false,elite:false,detailedEvents:true})),machine=new CardMachine(program,storage);
      let stop=machine.advance();while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);
      if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected battle root');
      const query=<I,O>(q:rules.Query<I,O>,input:I)=>inspectRuleQuery(combatContentDefinition,machine.root.state,q,input);
      const run=query(adventures.exports.instances,undefined)[0]!,session=query(combatSessions.exports.current,query(combatSessions.exports.forRun,run)!);
      const draw=query(cardPiles.exports.bindings,query(battles.exports.status,session.battle).piles).draw,order=query(zones.exports.members,draw);
      if(reverse){
        const components=stateOf(machine.root.state).entities[draw]!.components;
        const entry=Object.entries(components).find(([,value])=>Array.isArray(value)&&JSON.stringify(value)===JSON.stringify(order));
        assert.ok(entry);components[Number(entry[0])]=storage.own([...order].reverse());
      }
      const frame=stop.call.input,action=frame.actions.find(a=>describeAction(observe(frame),a.bits).kind==='drink-potion');assert.ok(action);
      return{current:new ProbabilityCurrent(machine),action};
    };
    const left=make(false),right=make(true);
    function futures(source:typeof left){
      const result=expandAll(source.current,source.action,{continueCall(stop,data){if(stop.call.port==='event')return{reply:null,data};}});
      try{return result.outcomes.map(row=>{const stop=row.current.inspect();if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected next battle');return{mass:row.mass,hand:observe(stop.call.input).battle!.hand};});}
      finally{for(const row of result.outcomes)row.current.close();}
    }
    const before=left.current.machine.storage.export(left.current.machine.root);
    try{
      const a=futures(left),b=futures(right);
      if(visible){assert.equal(a.length,1);assert.equal(b.length,1);assert.notDeepEqual(a,b);}
      else{assert.ok(a.length>1);assert.deepEqual(a,b);}
      assert.deepEqual(left.current.machine.storage.export(left.current.machine.root),before);
    }finally{left.current.close();right.current.close();}
  }
});


for(const [id,upgraded] of [['HAVOC',false],['SECRET_WEAPON',false],['SECRET_TECHNIQUE',false],['VIOLENCE',false],['VOLIBEAR_C07',false],['VOLIBEAR_U17',false],['VOLIBEAR_U17',true]] as const)test(`${id}${upgraded?'+':''} executes original card flow over probability-resolved draw order`,()=>{
  const program=new CardProgram(combatContentDefinition),machine=new CardMachine(program,privateCardGraph(program.initial({seed:'130',encounter:encounterId.CULTIST,relics:[],potion:null,durable:false,elite:false,detailedEvents:true,bottledCard:id,bottledUpgraded:upgraded,character:id.startsWith('VOLIBEAR')?'volibear':'ironclad'})));
  let stop=machine.advance();while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);
  if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected actual battle');
  const root=new ProbabilityCurrent(machine),other=root.fork(),view=observe(stop.call.input),action=stop.call.input.actions.find(a=>{const d=describeAction(view,a.bits);return d.kind==='play-card'&&view.battle!.hand[Number(d.details.hand)]?.id===id;});assert.ok(action);
  const query=<I,O>(q:rules.Query<I,O>,input:I)=>inspectRuleQuery(combatContentDefinition,other.machine.root.state,q,input);
  const run=query(adventures.exports.instances,undefined)[0]!,session=query(combatSessions.exports.current,query(combatSessions.exports.forRun,run)!),draw=query(cardPiles.exports.bindings,query(battles.exports.status,session.battle).piles).draw;
  const order=query(zones.exports.members,draw),components=stateOf(other.machine.root.state).entities[draw]!.components,key=Object.entries(components).find(([,value])=>Array.isArray(value)&&JSON.stringify(value)===JSON.stringify(order))![0];components[Number(key)]=other.machine.storage.own([...order].reverse());
  const before=machine.storage.export(machine.root),initial=CardProgram.prototype.initial;
  function menus(source:typeof root){
    // Compare the exact pushforward to public menus. Distinct random paths
    // may publish the same menu; add their rational masses rather than retain
    // thousands of identical full observations. This is only the test oracle,
    // not an equivalence claim about their hidden execution Contexts.
    const done=new Map<string,ReturnType<typeof probabilityMass>>();
    visitAll(source,action,node=>{
      const stop=node.current.inspect();if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected original card choice');
      const menu=observe(stop.call.input),key=JSON.stringify(menu);done.set(key,addMass(done.get(key)??zeroMass(),node.mass));
        if(id==='VOLIBEAR_U17'){
          const candidates=menu.battle!.select!.candidates;assert.ok(candidates);assert.equal(candidates.length,upgraded?3:2);
          const knowledge=inspectRuleQuery(combatContentDefinition,node.current.machine.root.state,zones.exports.orderKnowledge,draw);
          assert.equal(knowledge.resolved,false);assert.ok(knowledge.blocks.some(block=>block.length>1),'scry must leave unrevealed order uncertain');
          const skip=stop.call.input.actions.find(action=>{const d=describeAction(menu,action.bits);return d.kind==='skip-selection'||d.kind==='select-cards'&&(d.details.indices as number[]).length===0;});assert.ok(skip);
          const next=expandAll(node.current,skip,{continueCall(stop,data){if(stop.call.port==='event')return{reply:null,data};}});
          try{
            assert.equal(next.outcomes.length,1,'the already revealed next card is deterministic');
            const after=next.outcomes[0]!.current.inspect();if(after.kind!=='call'||after.call.port!=='decision')throw Error('Expected original post-scry continuation');
            const hand=observe(after.call.input).battle!.hand;
            assert.ok(hand.some(card=>card.uniqueId===candidates[0]!.card.uniqueId));
          }finally{for(const row of next.outcomes)row.current.close();}
        }
    },{continueCall(stop,data){if(stop.call.port==='event')return{reply:null,data};}});
    return [...done].sort(([a],[b])=>a<b?-1:a>b?1:0);
  }
  CardProgram.prototype.initial=function(){throw Error('No reinitialization in selection search');};
  try{
    const a=menus(root),b=menus(other);assert.ok(a.length>1);assert.deepEqual(a,b);assert.deepEqual(machine.storage.export(machine.root),before);
    if(id==='HAVOC'){
      assert.equal(a.length,order.length,'every hidden top card has its own original autoplay result');
      for(const [,mass]of a)assert.deepEqual(mass,probabilityMass(1n,BigInt(order.length)));
    }
    if(id==='VOLIBEAR_C07'){
      // Advance the actual current action once. No history or reconstructed root.
      let after=machine.advance(action);while(after.kind==='call'&&after.call.port==='event')after=machine.advance(null);
      if(after.kind!=='call'||after.call.port!=='decision')throw Error('Expected original card continuation');
      const remaining=inspectRuleQuery(combatContentDefinition,machine.root.state,zones.exports.members,draw);
      const knowledge=inspectRuleQuery(combatContentDefinition,machine.root.state,zones.exports.orderKnowledge,draw);
      assert.equal(remaining.length,order.length-1);
      assert.equal(knowledge.resolved,false);assert.ok(knowledge.language,'normal card execution records the conditional remaining order');
      assert.deepEqual([...knowledge.blocks.flat()].sort((a,b)=>a-b),[...remaining].sort((a,b)=>a-b));
      assert.ok(observe(after.call.input).battle!.hand.length>=view.battle!.hand.length);
    }
  }
  finally{CardProgram.prototype.initial=initial;root.close();other.close();}
});


test('the original integer atom exposes all 32 future results independently of the actual observed draw',()=>{
  const root=defineEffect<string,{integer:number}>(b=>{
    const rng=b.local<number>(),integer=b.local<number>();
    return sequence(b.assign(rng,spawnEntity({definition:stream,owner:null,scope:0,setup:b.read(v=>BigInt(v.input))})),call(begin,null),
      b.assign(integer,call(random.exports.int,{stream:rng,start:0,end:31})),b.return({integer}));
  });
  const definition=linkRules({id:'sts/condition-original-random',schemas:{setup:z.string(),result:z.object({integer:z.number()}),ports:{begin:{input:z.null(),output:z.null()}}},initialize:()=>({}),entry:root,definitions:[root,begin],modules:[random]});
  const program=new CardProgram(definition),storage=privateCardGraph(program.initial('130')),actual=new CardMachine(program,storage);actual.advance();
  const current=new ProbabilityCurrent(new CardMachine(program,storage.fork())),before=current.machine.storage.export(current.machine.root),initialize=CardProgram.prototype.initial;
  CardProgram.prototype.initial=function(){throw Error('Only the held current may be advanced');};
  let retained:{current:{close():void}}[]=[];
  try{
    const observed=actual.advance(null);assert.equal(observed.kind,'done');if(observed.kind!=='done')throw Error('Expected actual published result');
    const result=expandAll(current,null);retained=result.outcomes;
    assert.equal(result.outcomes.length,32);assert.ok(result.outcomes.every(row=>row.mass.numerator===1n&&row.mass.denominator===32n));
    assert.deepEqual(result.outcomes.map(row=>{const stop=row.current.inspect();if(stop.kind!=='done')throw Error('Expected integer result');return stop.result.integer;}).sort((a,b)=>a-b),Array.from({length:32},(_,i)=>i));
    const matching=result.outcomes.filter(row=>{const stop=row.current.inspect();return stop.kind==='done'&&stop.result.integer===observed.result.integer;});
    assert.equal(matching.length,1);assert.deepEqual(matching[0]!.mass,probabilityMass(1n,32n));assert.deepEqual(current.machine.storage.export(current.machine.root),before);
  }finally{CardProgram.prototype.initial=initialize;for(const row of retained)row.current.close();current.close();actual.storage.close?.();}
});

test('mapped integer entropy preserves normal RNG and coalesces only equal original values',()=>{
  const values=Array.from({length:100},(_,roll)=>roll<3?2:roll<40?1:0);
  const schema=z.object({value:z.number(),state:randomViewSchema});
  const root=defineEffect<string,z.infer<typeof schema>>(b=>{
    const rng=b.local<number>(),value=b.local<number>();return sequence(
      b.assign(rng,spawnEntity({definition:stream,owner:null,scope:0,setup:b.read(v=>BigInt(v.input))})),call(begin,null),
      b.assign(value,call(random.exports.mappedInt,{stream:rng,values,declarations:values.map(value=>({name:'original-value',value}))})),b.return({value,state:query(random.exports.current,rng)}));
  });
  const definition=linkRules({id:'sts/mapped-original-int',schemas:{setup:z.string(),result:schema,ports:{begin:{input:z.null(),output:z.null()}}},initialize:()=>({}),entry:root,definitions:[root,begin],modules:[random]});
  const program=new CardProgram(definition),storage=privateCardGraph(program.initial('130')),machine=new CardMachine(program,storage);machine.advance();
  const current=new ProbabilityCurrent(new CardMachine(program,storage.fork()));
  const result=expandAll(current,null);
  try{
    const rng=randomState(130n),value=values[randomInt(rng,0,99)]!;
    assert.deepEqual(machine.advance(null),{kind:'done',result:{value,state:rngView(rng)}});
    const publications=machine.takeProbabilityPublications();assert.deepEqual(publications,[{kind:'discrete-result',name:'original-value',value}]);
    assert.deepEqual(result.outcomes.map(row=>{const stop=row.current.inspect();if(stop.kind!=='done')throw Error('Expected original image result');return{value:stop.result.value,mass:row.mass};}),[
      {value:2,mass:probabilityMass(3n,100n)},{value:1,mass:probabilityMass(37n,100n)},{value:0,mass:probabilityMass(60n,100n)},
    ]);
  }finally{for(const row of result.outcomes)row.current.close();current.close();machine.storage.close?.();}
});

test('original potion generation declares only explicitly published accepted results',()=>{
  const output=z.object({potion:z.number(),state:randomViewSchema});
  const entry=defineEffect<boolean,z.infer<typeof output>>(b=>{
    const rng=b.local<number>(),potion=b.local<number>();return sequence(
      b.assign(rng,spawnEntity({definition:stream,owner:null,scope:0,setup:130n})),
      b.assign(potion,call(adventureDraws.exports.rewardPotion,b.read(v=>v.input?{stream:v.get(rng),publish:true}:v.get(rng)))),
      b.return({potion,state:query(random.exports.current,rng)}));
  });
  const definition=linkRules({id:'sts/potion-publication-boundary',schemas:{setup:z.boolean(),result:output,ports:{}},initialize:()=>({}),entry,definitions:[entry],modules:[adventureDraws]});
  const program=new CardProgram(definition),results:unknown[]=[];
  for(const published of [false,true]){
    const machine=new CardMachine(program,privateCardGraph(program.initial(published)));
    try{
      const stop=machine.advance();assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Expected original potion generation');
      results.push(stop.result);const declarations=machine.takeProbabilityPublications() as {name:string;value:unknown}[];
      if(!published)assert.deepEqual(declarations,[]);
      else{assert.equal(declarations.length,2);assert.equal(declarations[0]!.name,'reward-potion-rarity');assert.equal(declarations[1]!.name,'reward-potion');assert.equal(declarations[1]!.value,stop.result.potion);}
    }finally{machine.storage.close?.();}
  }
  assert.deepEqual(results[0],results[1],'publication cannot change the original output or RNG continuation');
});

test('float24 price images retain all rounding preimages without publishing hidden base prices',async()=>{
  const {float24Image}=await import('../src/rules/random.ts');
  const f=Math.fround,price=(roll:number)=>Math.trunc(f(75*roll)),final=(value:number)=>Math.trunc(value/2);
  const image=float24Image(.9,1.1,price).map(row=>({...row,constraints:[{name:'final-price',values:[final(row.value)]}]}));
  const output=z.object({value:z.number(),state:randomViewSchema});
  const entry=defineEffect<void,z.infer<typeof output>>(b=>{const rng=b.local<number>(),value=b.local<number>();return sequence(
    b.assign(rng,spawnEntity({definition:stream,owner:null,scope:0,setup:130n})),call(begin,null),
    b.assign(value,call(random.exports.mappedFloat,{stream:rng,image})),
    call(random.exports.declare,{name:'final-price',value:b.read(v=>final(v.get(value)))}),b.return({value:b.read(v=>final(v.get(value))),state:query(random.exports.current,rng)}),
  );});
  const definition=linkRules({id:'sts/mapped-float-price',schemas:{setup:z.undefined(),result:output,ports:{begin:{input:z.null(),output:z.null()}}},initialize:()=>({}),entry,definitions:[entry,begin],modules:[random]});
  const program=new CardProgram(definition),storage=privateCardGraph(program.initial(undefined)),machine=new CardMachine(program,storage);machine.advance();
  const current=new ProbabilityCurrent(new CardMachine(program,storage.fork()));
  try{
    const rng=randomState(130n),value=final(price(randomFloat(rng,.9,1.1))),actual=machine.advance(null);
    assert.deepEqual(actual,{kind:'done',result:{value,state:rngView(rng)}});
    const publications=machine.takeProbabilityPublications();assert.deepEqual(publications,[{kind:'discrete-result',name:'final-price',value}]);
    let end=0,count=0n,matching=0;for(const row of image){if(final(row.value)===value){count+=BigInt(row.end-end);matching++;}end=row.end;}
    assert.ok(matching>1,'one public price must retain multiple hidden base values');
    const result=expandAll(current,null);
    try{
      assert.equal(result.outcomes.length,image.length);
      const compatible=result.outcomes.filter(row=>{const stop=row.current.inspect();return stop.kind==='done'&&stop.result.value===value;});
      assert.equal(compatible.length,matching);assert.deepEqual(compatible.reduce((mass,row)=>addMass(mass,row.mass),zeroMass()),probabilityMass(count,1n<<24n));
      assert.equal(current.machine.root.stop!.kind,'call');
    }finally{for(const row of result.outcomes)row.current.close();}
  }finally{current.close();storage.close();}
});


test('grouped shuffle preserves the original RNG and executes order-dependent callbacks on the full proposed order',()=>{
  const items=[0,1,2,3,4],groups=[[0,2],[1,3,4]],output=z.object({order:z.array(z.number()),checksum:z.number(),state:randomViewSchema});
  const effect=defineEffect<string,z.infer<typeof output>>(b=>{
    const rng=b.local<number>(),order=b.local<readonly number[]>(),checksum=b.local<number>();
    return sequence(b.assign(rng,spawnEntity({definition:stream,owner:null,scope:0,setup:b.read(v=>BigInt(v.input))})),call(begin,null),
      b.assign(order,call(random.exports.shuffleGrouped,{stream:rng,items,groups})),b.assign(checksum,0),
      rules.forEach(order,item=>b.assign(checksum,b.read(v=>v.get(checksum)*7+v.get(item)))),
      b.return({order:b.read(v=>[...v.get(order)]),checksum,state:query(random.exports.current,rng)}));
  });
  const program=new CardProgram(linkRules({id:'sts/grouped-shuffle-continuation',schemas:{setup:z.string(),result:output,ports:{begin:{input:z.null(),output:z.null()}}},initialize:()=>({}),entry:effect,definitions:[effect,begin],modules:[random]}));
  const machine=new CardMachine(program,privateCardGraph(program.initial('130')));machine.advance();const current=new ProbabilityCurrent(new CardMachine(program,(machine.storage as import('../../../packages/runtime-card/src/graph.ts').CardGraph<any>).fork()));
  const before=current.machine.storage.export(current.machine.root);
  try{
    const rng=randomState(130n),shuffled=[...items];javaShuffle(shuffled,randomLong(rng));
    const order=[...shuffled.filter(i=>groups[0]!.includes(i)),...shuffled.filter(i=>groups[1]!.includes(i))];
    assert.deepEqual(machine.advance(null),{kind:'done',result:{order,checksum:order.reduce((sum,id)=>sum*7+id,0),state:rngView(rng)}});
    const result=expandAll(current,null);
    try{
      assert.equal(result.outcomes.length,12);
      const matching=result.outcomes.filter(row=>{const stop=row.current.inspect();return stop.kind==='done'&&stop.result.order.at(-1)===4&&stop.result.order.at(-2)===3;});
      const evidence=matching.reduce((mass,row)=>addMass(mass,row.mass),zeroMass());
      assert.deepEqual(evidence,probabilityMass(1n,6n));assert.equal(matching.length,2);
      const checksums=new Set<number>();
      for(const row of result.outcomes){
        const stop=row.current.inspect();if(stop.kind!=='done')throw Error('Expected original callback result');
        assert.equal(stop.result.checksum,stop.result.order.reduce((sum,id)=>sum*7+id,0));assert.deepEqual(row.mass,probabilityMass(1n,12n));
        if(matching.includes(row)){checksums.add(stop.result.checksum);assert.deepEqual(divideMass(row.mass,evidence),probabilityMass(1n,2n));}
      }
      assert.equal(checksums.size,2);assert.deepEqual(current.machine.storage.export(current.machine.root),before);
    }finally{for(const row of result.outcomes)row.current.close();}
  }finally{current.close();machine.storage.close?.();}
});

test('original combat declares only the same immutable roster names as its public view',()=>{
  const program=new CardProgram(combatContentDefinition);
  for(const encounter of [encounterId.LAGAVULIN,encounterId.THREE_SENTRIES,encounterId.GREMLIN_NOB]){
    const machine=new CardMachine(program,privateCardGraph(program.initial({seed:'130',encounter,relics:['RUNIC_DOME','NEOWS_LAMENT'],potion:null,durable:false,elite:true,detailedEvents:true})));
    const publications:unknown[]=[];
    try{
      let stop=machine.advance();publications.push(...machine.takeProbabilityPublications());
      while(stop.kind==='call'&&stop.call.port==='event'){stop=machine.advance(null);publications.push(...machine.takeProbabilityPublications());}
      assert.equal(stop.kind,'call');if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected original combat decision');
      const received=contract.ports.decision.receive(stop.call.input),view=contract.observe(received.view,'0');
      assert.ok(view.battle);
      assert.deepEqual(publications.filter(value=>value!==null&&typeof value==='object'&&'kind' in value&&value.kind!=='ordered-prefix'),[{kind:'discrete-result',name:'combat-roster',value:JSON.stringify(view.battle.monsters.map(enemy=>enemy.name))}]);
    }finally{machine.storage.close?.();}
  }
});

test('original merchant publishes final prices after its sale and discount sequence',async()=>{
  const {shopCaseFixture}=await import('./adventure-case-fixture.ts');
  const {inspectRuleQuery}=await import('../../../packages/card-engine/src/rules-inspection.ts');
  const {adventures}=await import('../src/rules/adventures.ts');
  const {adventureViews}=await import('../src/adapters/adventure-views.ts');
  for(const owned of [[],['THE_COURIER'],['MEMBERSHIP_CARD'],['THE_COURIER','MEMBERSHIP_CARD','SMILING_MASK','MAW_BANK']] as import('../src/identifiers.ts').RelicId[][]){
    const definition=shopCaseFixture(owned),program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial({seed:'130'})));
    const declarations:unknown[]=[];
    try{
      let stop=machine.advance();declarations.push(...machine.takeProbabilityPublications());
      while(stop.kind==='call'&&stop.call.port==='event'){stop=machine.advance(null);declarations.push(...machine.takeProbabilityPublications());}
      assert.equal(stop.kind,'call');if(stop.kind!=='call')throw Error(JSON.stringify(stop));assert.equal(stop.call.port,'decision');
      const ids=inspectRuleQuery(definition,machine.root.state,adventures.exports.instances,undefined);
      const view=inspectRuleQuery(definition,machine.root.state,adventureViews.exports.privateGame,ids[0]!);
      assert.ok(view.shop);assert.equal(view.shop.prices.length,13);
      const prices=declarations.filter((value):value is {kind:string;name:string;value:number}=>value!==null&&typeof value==='object'&&'name' in value&&typeof value.name==='string'&&value.name.startsWith('shop-price-'));
      assert.deepEqual(prices,view.shop.prices.map((value,index)=>({kind:'discrete-result',name:'shop-price-'+index,value})));
      assert.ok(declarations.every(value=>value!==null&&typeof value==='object'&&'kind' in value&&value.kind==='discrete-result'),'actual execution must never publish candidate constraints');
    }finally{machine.storage.close?.();}
  }
});

test('fixed encounter constraints describe the original roster without pruning an unconditional future',async()=>{
  const {encounters}=await import('../src/rules/encounters.ts');
  const {encounterContent}=await import('../src/content/enemies/encounters.ts');
  const {enemies}=await import('../src/rules/enemies.ts');
  const {publicMonsterName}=await import('../src/content/enemies/shared/programs.ts');
  const output=z.object({names:z.array(z.string()),counter:z.number()});
  const effect=defineEffect<number,z.infer<typeof output>>(b=>{
    const rng=b.local<number>(),encounter=b.local<number>(),catalog=b.local<{id:number;definition:import('../src/rules/encounters.ts').EncounterDefinition}[]>();
    return sequence(b.assign(catalog,encounterContent.exports.definitions),b.assign(rng,spawnEntity({definition:stream,owner:null,scope:0,setup:130n})),call(begin,null),
      b.assign(encounter,spawnEntity({kind:encounters.exports.kind,definition:b.read(v=>v.get(catalog).find(row=>row.id===v.input)!.definition),owner:null,scope:0,setup:{run:0,miscRng:rng,hpRng:rng,scope:0,ascension:20}})),
      b.return({names:b.read(v=>v.query(encounters.exports.current,v.get(encounter)).map(row=>publicMonsterName(row===null?null:v.query(enemies.exports.metadata,row.definition)))),counter:b.read(v=>v.query(random.exports.current,v.get(rng)).counter)}));
  });
  const definition=linkRules({id:'original-fixed-roster-constraint',schemas:{setup:z.number(),result:output,ports:{begin:{input:z.null(),output:z.null()}}},initialize:()=>({}),entry:effect,definitions:[effect,begin],modules:[encounterContent,random],initialEntities:[0]});
  const program=new CardProgram(definition);
  for(const encounter of [encounterId.THREE_SENTRIES,encounterId.AUTOMATON,encounterId.REPTOMANCER]){
    const machine=new CardMachine(program,privateCardGraph(program.initial(encounter)));assert.equal(machine.advance().kind,'call');const root=new ProbabilityCurrent(machine),before=machine.storage.export(machine.root);
    try{
      const future=expandAll(root,null,{stopAtBoundary:'public-constraint'});
      try{
        assert.equal(future.outcomes.length,1);assert.deepEqual(future.outcomes[0]!.mass,unitMass());
        const child=future.outcomes[0]!.current;assert.equal(child.advance(0n).kind,'chance');const conditions=child.machine.takeProbabilityPublications();
        assert.deepEqual(machine.storage.export(machine.root),before,'future construction must leave the actual current untouched');
        const normal=machine.advance(null);assert.equal(normal.kind,'done');if(normal.kind!=='done')throw Error('Expected original construction');
        assert.deepEqual(conditions,[{kind:'probability-constraint',name:'combat-roster',values:[JSON.stringify(normal.result.names)]}]);
        assert.ok(normal.result.counter>0);assert.deepEqual(machine.takeProbabilityPublications(),[],'normal execution must not publish constraints or change visible events');
      }finally{for(const row of future.outcomes)row.current.close();}
    }finally{root.close();}
  }
});

// The original pile operations may have observers that keep the shuffle in
// other state. Forgetting only the order would destroy that joint result.
for(const shuffle of ['draw','discard'] as const)test(`original ${shuffle} shuffle retains correlations with linked order observers`,()=>{
  for(const mode of ['none','reaction','self-removing','movement','scheduled','modifier','replacement'] as const){
    const shuffleView=z.object({order:z.array(z.number()),seen:z.array(z.number()),calls:z.number(),resolved:z.boolean()});
    const shuffled=ruleModules.portEffect<z.infer<typeof shuffleView>,null>('shuffled');
    const hooks=rules.defineRules({requires:[cardPiles,basicCards],build(m){
      const memory=m.own(rules.defineComponent({schema:z.object({seen:z.array(z.number()),calls:z.number()}),initial:()=>({seen:[],calls:0})}));
      const kind=m.kind({config:z.undefined(),components:[memory]});
      const record=m.atom({input:z.object({entity:z.number(),order:z.array(z.number()).readonly()}),output:z.undefined(),reads:[memory],writes:[memory],emits:[],run(r,i){return{writes:[{entity:i.entity,component:memory,value:{seen:[...i.order],calls:r.component(i.entity,memory).calls+1}}],events:[],result:undefined};}});
      const read=rules.defineQuery({input:z.number(),output:z.object({seen:z.array(z.number()),calls:z.number()}),reads:[memory],base:(r,id)=>r.component(id,memory)});
      const reordered=mode==='reaction'||mode==='self-removing'?rules.on(zones.exports.reordered,{effect:defineEffect<rules.ReactionContext<{zone:number;order:readonly number[]}>,void>(b=>sequence(
        call(record,{entity:b.read(v=>v.input.source),order:b.read(v=>v.input.event.order)}),
        ...(mode==='self-removing'?[rules.uninstall(b.read(v=>v.input.registration))]:[]),
      ))}):undefined;
      const moved=mode==='movement'?rules.on(zones.exports.moved,{effect:defineEffect<rules.ReactionContext<{to:number|null}>,void>(b=>rules.when(b.read(v=>v.input.event.to!==null),call(record,{entity:b.read(v=>v.input.source),order:b.read(v=>v.query(zones.exports.members,v.input.event.to!))})))}):undefined;
      const modified=mode==='modifier'?rules.modify(zones.exports.capacity,{transform:(_r,c)=>c.value}):undefined;
      type Move={entity:number;from:number|null;to:number|null;index:number};
      const replaced=mode==='replacement'?rules.replace(zones.exports.moving,{effect:defineEffect<rules.ReplacementContext<Move>,rules.ReplacementResult<Move>>(b=>b.return({kind:'keep',value:b.read(v=>v.input.value)}))}):undefined;
      const scheduled=defineEffect<{entity:number;zone:number},void>(b=>call(record,{entity:b.read(v=>v.input.entity),order:query(zones.exports.members,b.read(v=>v.input.zone))}));
      return{exports:{kind,read,reordered,moved,modified,replaced,scheduled}};
    }});
    const watcher=defineEntity(hooks.exports.kind,undefined),actor=defineEntity(resources.exports.actor,{side:0});
    const pile=defineEntity(cardPiles.exports.kind,undefined),zone=defineEntity(zones.exports.kind,{capacity:null}),handZone=defineEntity(zones.exports.kind,{capacity:10});
    const effect=defineEffect<void,{order:number[];seen:number[];calls:number;counter:number}>(b=>{
      const owner=b.local<number>(),draw=b.local<number>(),hand=b.local<number>(),discard=b.local<number>(),exhaust=b.local<number>(),rng=b.local<number>(),piles=b.local<number>(),observer=b.local<number>(),made=b.local<number>();
      const catalog=b.local<readonly rules.EntityDefinition<import('../src/rules/card-instances.types.ts').CardConfig,import('../src/rules/card-instances.types.ts').CardSetup>[]>();
      const state=()=>b.read(v=>({order:[...v.query(zones.exports.members,v.get(draw))],...v.query(hooks.exports.read,v.get(observer)),resolved:v.query(zones.exports.orderKnowledge,v.get(draw)).resolved}));
      return sequence(
        b.assign(owner,spawnEntity({definition:actor,owner:null,scope:0,setup:{hp:80,maxHp:80,energy:3,block:0,gold:0}})),
        b.assign(draw,spawnEntity({definition:zone,owner,scope:0})),b.assign(hand,spawnEntity({definition:handZone,owner,scope:0})),b.assign(discard,spawnEntity({definition:zone,owner,scope:0})),b.assign(exhaust,spawnEntity({definition:zone,owner,scope:0})),
        b.assign(rng,spawnEntity({definition:stream,owner:null,scope:0,setup:130n})),b.assign(observer,spawnEntity({definition:watcher,owner,scope:0})),
        b.assign(piles,spawnEntity({definition:pile,owner,scope:0,setup:{actor:owner,battle:owner,draw,hand,discard,exhaust,shuffleRng:rng,cardRng:rng,actionScope:0}})),
        b.assign(catalog,[basicCards.exports.StrikeRed,basicCards.exports.DefendRed,basicCards.exports.Bash]),
        rules.forEach([0,1,2],index=>sequence(b.assign(made,spawnEntity({kind:cardInstances.exports.kind,definition:b.read(v=>v.get(catalog)[v.get(index)]!),owner,scope:0,setup:{mode:1,master:null,uniqueId:index,upgraded:false,specialData:0}})),
          call(cardPiles.exports.register,{piles,card:made}),call(zones.exports.move,{entity:made,from:null,to:shuffle==='draw'?draw:discard,index}),
        )),
        ...(mode==='none'?[]:mode==='scheduled'?[rules.schedule(hooks.exports.scheduled,{entity:observer,zone:draw},{queue:actionQueue,source:observer,lifetime:0,at:{event:zones.exports.reordered}})]:[rules.install({ability:(mode==='movement'?hooks.exports.moved:mode==='modifier'?hooks.exports.modified:mode==='replacement'?hooks.exports.replaced:hooks.exports.reordered)!,source:observer,owner,environment:{},lifetime:0})]),
        call(begin,null),call(shuffle==='draw'?cardPiles.exports.shuffleDraw:cardPiles.exports.shuffleDiscard,piles),ruleModules.drainQueue(actionQueue),call(shuffled,state()),
        call(zones.exports.resolveOrder,b.read(v=>({zone:v.get(draw),keys:v.query(zones.exports.members,v.get(draw)).map(entity=>({entity,key:entity}))}))),
        b.return(b.read(v=>({order:[...v.query(zones.exports.members,v.get(draw))],...v.query(hooks.exports.read,v.get(observer)),counter:v.query(random.exports.current,v.get(rng)).counter}))),
      );
    });
    const definition=linkRules({id:`sts/shuffle-observers/${shuffle}/${mode}`,schemas:{setup:z.undefined(),result:z.object({order:z.array(z.number()),seen:z.array(z.number()),calls:z.number(),counter:z.number()}),ports:{begin:{input:z.null(),output:z.null()},shuffled:{input:shuffleView,output:z.null()}}},initialize:()=>({}),entry:effect,definitions:[effect,begin,shuffled],modules:[hooks]});
    const program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));
    const start=machine.advance();assert.equal(start.kind,'call',JSON.stringify(start));
    const root=new ProbabilityCurrent(machine),before=machine.storage.export(machine.root);
    // Each forward edge executes once; the fork keeps the same current state.
    const normal=root.fork();
    try{
      const stop=normal.machine.advance(null);assert.equal(stop.kind,'call',JSON.stringify(stop));
      const done=normal.machine.advance(null);assert.equal(done.kind,'done',JSON.stringify(done));
      if(done.kind==='done'){assert.equal(done.result.counter,1);if(mode==='reaction'||mode==='self-removing'||mode==='scheduled'||mode==='movement'&&shuffle==='discard')assert.deepEqual(done.result.seen,done.result.order);}
    }finally{normal.close();}
    let frontier:{outcomes:{current:typeof root;mass:ReturnType<typeof probabilityMass>}[]}|undefined;
    try{
      frontier=expandAll(root,null);
      assert.equal(frontier.outcomes.length,6);
      const orders=new Set<string>();
      for(const row of frontier.outcomes){
        const stop=row.current.inspect();assert.equal(stop.kind,'call');if(stop.kind!=='call'||stop.call.port!=='shuffled')throw Error('Expected original shuffle boundary');
        const observed=shuffleView.parse(stop.call.input);
        assert.equal(observed.resolved,true,`${shuffle}/${mode}: each branch already owns its original shuffled order`);
        assert.deepEqual(row.mass,probabilityMass(1n,6n));
        orders.add(JSON.stringify(observed.order));
        const saved=structuredClone(row.current.snapshot());row.current.close();
        const resumed=new ProbabilityCurrent(new CardMachine(program,privateCardGraph(saved.context,saved.immutable,saved.nullPrototypes,saved.contextValues)));
        const future=(()=>{try{return expandAll(resumed,null);}finally{resumed.close();}})();
        try{
          assert.equal(future.outcomes.length,1,`${shuffle}/${mode}: concealment must not introduce a second shuffle`);
          for(const next of future.outcomes){const done=next.current.inspect();assert.equal(done.kind,'done');if(done.kind!=='done')throw Error('Expected result');assert.deepEqual(next.mass,probabilityMass(1n));assert.equal(done.result.counter,1);assert.deepEqual(done.result.order,observed.order,'later observations retain the same permutation even without an in-shuffle callback');assert.deepEqual(done.result.seen,observed.seen,'an order resolution must never execute the callback again');assert.equal(done.result.calls,observed.calls);}
        }finally{for(const next of future.outcomes)next.current.close();}
      }
      assert.equal(orders.size,6,'all distinct original permutations remain represented');
      assert.deepEqual(machine.storage.export(machine.root),before);
    }finally{for(const row of frontier?.outcomes??[])row.current.close();root.close();}
  }
});

test('original random insertion preserves its legal positions through normal concealment and probability continuation',()=>{
  const actor=defineEntity(resources.exports.actor,{side:0}),pile=defineEntity(cardPiles.exports.kind,undefined);
  const zone=defineEntity(zones.exports.kind,{capacity:null}),handZone=defineEntity(zones.exports.kind,{capacity:10});
  const view=z.object({order:z.array(z.number()),card:z.number(),counter:z.number()});
  const inserted=ruleModules.portEffect<z.infer<typeof view>,null>('inserted');
  const setup=z.object({count:z.number(),hidden:z.boolean()});
  const effect=defineEffect<z.infer<typeof setup>,z.infer<typeof view>>(b=>{
    const owner=b.local<number>(),draw=b.local<number>(),hand=b.local<number>(),discard=b.local<number>(),exhaust=b.local<number>();
    const rng=b.local<number>(),piles=b.local<number>(),card=b.local<number>();
    const state=()=>b.read(v=>({order:[...v.query(zones.exports.members,v.get(draw))],card:v.get(card),counter:v.query(random.exports.current,v.get(rng)).counter}));
    return sequence(
      b.assign(owner,spawnEntity({definition:actor,owner:null,scope:0,setup:{hp:80,maxHp:80,energy:3,block:0,gold:0}})),
      b.assign(draw,spawnEntity({definition:zone,owner,scope:0})),b.assign(hand,spawnEntity({definition:handZone,owner,scope:0})),
      b.assign(discard,spawnEntity({definition:zone,owner,scope:0})),b.assign(exhaust,spawnEntity({definition:zone,owner,scope:0})),
      b.assign(rng,spawnEntity({definition:stream,owner:null,scope:0,setup:130n})),
      b.assign(piles,spawnEntity({definition:pile,owner,scope:0,setup:{actor:owner,battle:owner,draw,hand,discard,exhaust,shuffleRng:rng,cardRng:rng,actionScope:0}})),
      call(cardPiles.exports.initializeDeck,{piles,masters:[],bottled:[],drawPerTurn:0}),
      rules.forEach(b.read(v=>Array.from({length:v.input.count})),()=>call(cardPiles.exports.create,{piles,definition:basicCards.exports.StrikeRed,upgraded:false,specialData:0,destination:0,shuffle:false,mutable:null})),
      rules.when(b.read(v=>v.input.hidden),call(zones.exports.conceal,{zone:draw,blocks:[b.read(v=>[...v.query(zones.exports.members,v.get(draw))])],unsupported:false})),
      call(begin,null),b.assign(card,call(cardPiles.exports.create,{piles,definition:basicCards.exports.DefendRed,upgraded:false,specialData:0,destination:0,shuffle:true,mutable:null})),
      call(inserted,state()),call(cardPiles.exports.resolveDrawOrder,piles),b.return(state()),
    );
  });
  const definition=linkRules({id:'sts/original-insertion-space',schemas:{setup,result:view,ports:{begin:{input:z.null(),output:z.null()},inserted:{input:view,output:z.null()}}},initialize:()=>({}),entry:effect,definitions:[effect,begin,inserted],modules:[cardPiles,basicCards]});
  const program=new CardProgram(definition);
  for(const count of [0,1,3])for(const hidden of [false,true]){
    const machine=new CardMachine(program,privateCardGraph(program.initial({count,hidden})));
    assert.equal(machine.advance().kind,'call');const root=new ProbabilityCurrent(machine),normal=root.fork();
    const before=machine.storage.export(machine.root),initialize=CardProgram.prototype.initial;
    let probabilities:{outcomes:{current:typeof root;mass:ReturnType<typeof probabilityMass>}[]}|undefined;
    CardProgram.prototype.initial=()=>{throw Error('Original insertion must continue held currents');};
    try{
      const actual=normal.machine.advance(null);assert.equal(actual.kind,'call');if(actual.kind!=='call')throw Error('Expected insertion boundary');
      const observed=view.parse(actual.call.input),slots=Math.max(1,count),orders=hidden&&count===3?6:1;
      assert.ok(count===0||observed.order.at(-1)!==observed.card);
      const saved=structuredClone(normal.snapshot());normal.close();
      const restored=new ProbabilityCurrent(new CardMachine(program,privateCardGraph(saved.context,saved.immutable,saved.nullPrototypes,saved.contextValues)));
      const future=(()=>{try{return expandAll(restored,null);}finally{restored.close();}})();
      const expected=new Map<string,ReturnType<typeof probabilityMass>>();
      try{
        assert.equal(future.outcomes.length,slots*orders);
        for(const row of future.outcomes){
          const done=row.current.inspect();assert.equal(done.kind,'done');if(done.kind!=='done')throw Error('Expected resolved insertion');
          assert.ok(count===0||done.result.order.indexOf(done.result.card)<count);
          assert.equal(done.result.counter,observed.counter);assert.deepEqual(row.mass,probabilityMass(1n,BigInt(slots*orders)));
          expected.set(JSON.stringify(done.result.order),row.mass);
        }
        assert.equal(expected.size,slots*orders);assert.ok(expected.has(JSON.stringify(observed.order)));
      }finally{for(const row of future.outcomes)row.current.close();}
      probabilities=expandAll(root,null);assert.equal(probabilities.outcomes.length,slots*orders);
      const generated=new Map<string,ReturnType<typeof probabilityMass>>();
      for(const row of probabilities.outcomes){
        const stop=row.current.inspect();assert.equal(stop.kind,'call');if(stop.kind!=='call')throw Error('Expected insertion boundary');
        const now=view.parse(stop.call.input);generated.set(JSON.stringify(now.order),row.mass);
        assert.equal(now.counter,observed.counter);
        const next=expandAll(row.current,null);
        try{assert.equal(next.outcomes.length,1);assert.deepEqual(next.outcomes[0]!.current.inspect(),{kind:'done',result:now});}
        finally{for(const child of next.outcomes)child.current.close();}
      }
      assert.deepEqual(generated,expected);assert.deepEqual(machine.storage.export(machine.root),before);
    }finally{CardProgram.prototype.initial=initialize;for(const row of probabilities?.outcomes??[])row.current.close();normal.close();root.close();}
  }
});
