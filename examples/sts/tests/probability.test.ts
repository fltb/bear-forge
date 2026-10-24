import {adventureDraws} from '../src/content/rewards/draws.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CardProgram,CardMachine,linkRules,ruleModules} from '@bear-forge/card-engine';
import {createCardLoader} from '@bear-forge/runtime-card';
import {createGameBinder} from '@bear-forge/game-host';
import {forkGameCurrent} from '../../../packages/game-host/src/current.ts';
import {ProbabilityCurrent,nextProbability,nextProbabilityFrontier,conditionedNextProbabilityFrontier,takeProbabilityCurrent} from '../../../packages/runtime-card/src/probability.ts';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {generateProbability,permutationAt} from '../../../packages/card-engine/src/probability.ts';
import {rules} from '../src/rules/execution.ts';
import {random} from '../src/rules/random.ts';
import {randomState,randomInt,randomBoolean,randomLong,randomFloat,javaShuffle,rngView} from '../src/rng.ts';
import {randomViewSchema} from '../src/rules/random.schemas.ts';
import {combatContentDefinition} from './combat-content-fixture.ts';
import {encounterId,potionId} from '../src/identifiers.ts';
import {describeAction} from '../src/presentation.ts';
import {observe,contract} from '../src/contract.ts';
import type {Ports,Frame} from '../src/game.schemas.ts';
import {searchEntropyWord} from '../../../packages/policies/src/search/entropy.ts';
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
      const chance=current.advance(2n);assert.deepEqual(chance,{kind:'chance',space:{kind:'weighted',weights:[.75,.25]}});
      if(chance.kind!=='chance')throw Error('Expected chance');
      assert.deepEqual(generateProbability(chance.space,8,{word(){throw Error('Exact');},check(){}}).outcomes,[{coordinate:0n,probability:.75},{coordinate:1n,probability:.25}]);
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
  type Node={current:typeof root;probability:number};
  const owned=new Set<typeof root>();
  let cursor={state:76,position:0};
  const entropy={check(){},word(){const result=searchEntropyWord(cursor);cursor=result.random;return result.value;}};
  function toDecision(source:typeof root,reply:unknown):Node[]{
    const pending:Node[]=[],finished:Node[]=[];
    const add=(parent:typeof root,reply:unknown,weight:number)=>{
      const result=nextProbability(parent,reply,{maximum:8-pending.length-finished.length,entropy});
      for(const o of result.outcomes){owned.add(o.current);pending.push({current:o.current,probability:weight*o.probability});}
    };
    add(source,reply,1);
    while(pending.length){
      const node=pending.shift()!,stop=node.current.inspect();
      if(stop.kind==='call'&&stop.call.port==='event'){
        add(node.current,null,node.probability);node.current.close();owned.delete(node.current);
      }else finished.push(node);
    }
    return finished;
  }
  try{
    CardProgram.prototype.initial=function(){throw Error('Search must not initialize');};
    const results=toDecision(root,action);
    assert.ok(results.length>1);assert.ok(Math.abs(results.reduce((sum,o)=>sum+o.probability,0)-1)<1e-12);
    const offered=new Set<string>();
    for(const {current} of results){
      assert.equal(current.machine.program,program);
      const stop=current.inspect();assert.equal(stop.kind,'call');
      if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected original nested decision');
      const nested=observe(stop.call.input);
      assert.ok(nested.battle?.select?.candidates?.length);offered.add(JSON.stringify(nested.battle.select.candidates));
      const selected=stop.call.input.actions[0]!;
      const children=toDecision(current,selected);
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
  }finally{CardProgram.prototype.initial=initialize;for(const current of owned)current.close();root.close();unwrap(await game.close());}
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
      type Node={current:typeof source.current;probability:number};
      const pending:Node[]=[],done:Node[]=[],owned=new Set<typeof source.current>();let cursor={state:37,position:0};
      const entropy={check(){},word(){const r=searchEntropyWord(cursor);cursor=r.random;return r.value;}};
      const advance=(current:typeof source.current,reply:unknown,probability:number)=>{
        const result=nextProbability(current,reply,{maximum:8-pending.length-done.length,entropy});
        for(const child of result.outcomes){owned.add(child.current);pending.push({current:child.current,probability:probability*child.probability});}
      };
      try{
        advance(source.current,source.action,1);
        while(pending.length){const node=pending.shift()!,stop=node.current.inspect();if(stop.kind==='call'&&stop.call.port==='event'){advance(node.current,null,node.probability);node.current.close();owned.delete(node.current);}else done.push(node);}
        return done.map(node=>{const stop=node.current.inspect();if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected next battle');return{probability:node.probability,hand:observe(stop.call.input).battle!.hand};});
      }finally{for(const current of owned)current.close();}
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


for(const [id,upgraded] of [['SECRET_WEAPON',false],['SECRET_TECHNIQUE',false],['VIOLENCE',false],['VOLIBEAR_C07',false],['VOLIBEAR_U17',false],['VOLIBEAR_U17',true]] as const)test(`${id}${upgraded?'+':''} executes original card flow over probability-resolved draw order`,()=>{
  const program=new CardProgram(combatContentDefinition),machine=new CardMachine(program,privateCardGraph(program.initial({seed:'130',encounter:encounterId.CULTIST,relics:[],potion:null,durable:false,elite:false,detailedEvents:true,bottledCard:id,bottledUpgraded:upgraded,character:id.startsWith('VOLIBEAR')?'volibear':'ironclad'})));
  let stop=machine.advance();while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);
  if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected actual battle');
  const root=new ProbabilityCurrent(machine),other=root.fork(),view=observe(stop.call.input),action=stop.call.input.actions.find(a=>{const d=describeAction(view,a.bits);return d.kind==='play-card'&&view.battle!.hand[Number(d.details.hand)]?.id===id;});assert.ok(action);
  const query=<I,O>(q:rules.Query<I,O>,input:I)=>inspectRuleQuery(combatContentDefinition,other.machine.root.state,q,input);
  const run=query(adventures.exports.instances,undefined)[0]!,session=query(combatSessions.exports.current,query(combatSessions.exports.forRun,run)!),draw=query(cardPiles.exports.bindings,query(battles.exports.status,session.battle).piles).draw;
  const order=query(zones.exports.members,draw),components=stateOf(other.machine.root.state).entities[draw]!.components,key=Object.entries(components).find(([,value])=>Array.isArray(value)&&JSON.stringify(value)===JSON.stringify(order))![0];components[Number(key)]=other.machine.storage.own([...order].reverse());
  const before=machine.storage.export(machine.root),initial=CardProgram.prototype.initial;
  function menus(source:typeof root){
    const owned=new Set<typeof root>(),pending:{current:typeof root;probability:number}[]=[],done:{view:ReturnType<typeof observe>;probability:number}[]=[];let cursor={state:4627,position:0};
    const entropy={check(){},word(){const r=searchEntropyWord(cursor);cursor=r.random;return r.value;}};
    const advance=(parent:typeof root,reply:unknown,weight:number)=>{const next=nextProbability(parent,reply,{maximum:8-pending.length-done.length,entropy});for(const child of next.outcomes){owned.add(child.current);pending.push({current:child.current,probability:weight*child.probability});}};
    try{advance(source,action,1);while(pending.length){const node=pending.shift()!,stop=node.current.inspect();if(stop.kind==='call'&&stop.call.port==='event')advance(node.current,null,node.probability);else if(stop.kind==='call'&&stop.call.port==='decision'){
        const menu=observe(stop.call.input);done.push({view:menu,probability:node.probability});
        if(id==='VOLIBEAR_U17'){
          const candidates=menu.battle!.select!.candidates;assert.ok(candidates);assert.equal(candidates.length,upgraded?3:2);
          const knowledge=inspectRuleQuery(combatContentDefinition,node.current.machine.root.state,zones.exports.orderKnowledge,draw);
          assert.equal(knowledge.resolved,false);assert.ok(knowledge.blocks.some(block=>block.length>1),'scry must leave unrevealed order uncertain');
          const skip=stop.call.input.actions.find(action=>{const d=describeAction(menu,action.bits);return d.kind==='skip-selection'||d.kind==='select-cards'&&(d.details.indices as number[]).length===0;});assert.ok(skip);
          const next=nextProbabilityFrontier({representation:'exact',outcomes:[{current:node.current,probability:1,data:null}]},()=>skip,{maximum:8,entropy,continueCall(stop,data){if(stop.call.port==='event')return{reply:null,data};}});
          try{
            assert.equal(next.outcomes.length,1,'the already revealed next card is deterministic');
            const after=next.outcomes[0]!.current.inspect();if(after.kind!=='call'||after.call.port!=='decision')throw Error('Expected original post-scry continuation');
            const hand=observe(after.call.input).battle!.hand;
            assert.ok(hand.some(card=>card.uniqueId===candidates[0]!.card.uniqueId));
          }finally{for(const row of next.outcomes)row.current.close();}
        }
      }else throw Error('Expected card choice');node.current.close();owned.delete(node.current);}return done;}
    finally{for(const current of owned)current.close();}
  }
  CardProgram.prototype.initial=function(){throw Error('No reinitialization in selection search');};
  try{
    const a=menus(root),b=menus(other);assert.ok(a.length>1);assert.deepEqual(a,b);assert.deepEqual(machine.storage.export(machine.root),before);
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


test('original STS random atom conditions an already published result across a support larger than the accepted-world cap',()=>{
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
    const result=conditionedNextProbabilityFrontier({representation:'exact',outcomes:[{current,probability:1,data:null}]},()=>null,{
      maximum:1,attempts:64,entropy:{word(){throw Error('Small conditioned space must enumerate');},check(){}},
      likelihood(candidate){const stop=candidate.inspect();return stop.kind==='done'&&stop.result.integer===observed.result.integer?1:0;},
    });
    retained=result.frontier?.outcomes??[];
    assert.equal(result.evidence,1/32);assert.ok(result.frontier);assert.equal(result.frontier.representation,'exact');assert.equal(result.frontier.outcomes.length,1);
    assert.deepEqual(result.frontier.outcomes[0]!.current.inspect(),observed);assert.deepEqual(current.machine.storage.export(current.machine.root),before);
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
  const conditioned=new ProbabilityCurrent(new CardMachine(program,storage.fork()));
  const result=nextProbability(current,null,{maximum:8,entropy:{check(){},word(){throw Error('Three image values must enumerate exactly');}}});
  try{
    const rng=randomState(130n),value=values[randomInt(rng,0,99)]!;
    assert.deepEqual(machine.advance(null),{kind:'done',result:{value,state:rngView(rng)}});
    const publications=machine.takeProbabilityPublications(),mass=values.filter(item=>item===value).length/values.length;
    const posterior=conditionedNextProbabilityFrontier({representation:'exact',outcomes:[{current:conditioned,probability:1,data:null}]},()=>null,{maximum:2,attempts:64,hint:publications,publications,entropy:{check(){},word:()=>123456},likelihood:()=>1});
    try{
      assert.equal(posterior.evidence,mass);assert.equal(posterior.frontier!.representation,'particles');assert.equal(posterior.frontier!.outcomes.length,1);
      const observed=posterior.frontier!.outcomes[0]!.current.inspect();assert.equal(observed.kind,'done');if(observed.kind==='done')assert.equal(observed.result.value,value);
    }finally{for(const row of posterior.frontier?.outcomes??[])row.current.close();}

    assert.deepEqual(result.outcomes.map(row=>{const stop=row.current.inspect();assert.equal(stop.kind,'done');return{value:stop.kind==='done'?stop.result.value:null,probability:row.probability};}),[{value:2,probability:.03},{value:1,probability:.37},{value:0,probability:.6}]);
  }finally{for(const row of result.outcomes)row.current.close();current.close();conditioned.close();machine.storage.close?.();}
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
    let end=0,mass=0,matching=0;for(const row of image){if(final(row.value)===value){mass+=(row.end-end)/2**24;matching++;}end=row.end;}
    assert.ok(matching>1,'the public price must not determine one hidden base value');
    const posterior=conditionedNextProbabilityFrontier({representation:'exact',outcomes:[{current,probability:1,data:null}]},()=>null,{maximum:8,attempts:64,entropy:{check(){},word:()=>12345},hint:publications,publications,likelihood:()=>1});
    try{
      assert.equal(posterior.evidence,mass);assert.equal(posterior.frontier!.outcomes.length,matching);
      for(const row of posterior.frontier!.outcomes){const stop=row.current.inspect();assert.equal(stop.kind,'done');if(stop.kind==='done')assert.equal(stop.result.value,value);}
      assert.equal(current.machine.root.stop!.kind,'call');
    }finally{for(const row of posterior.frontier?.outcomes??[])row.current.close();}
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
    let cursor={state:13,position:0};
    const result=conditionedNextProbabilityFrontier({representation:'exact',outcomes:[{current,probability:1,data:null}]},()=>null,{maximum:8,attempts:64,hint:[{kind:'ordered-prefix',orderedMembers:[4]},{kind:'ordered-prefix',orderedMembers:[3]}],entropy:{check(){},word(){const next=searchEntropyWord(cursor);cursor=next.random;return next.value;}},likelihood:child=>{const stop=child.inspect();return stop.kind==='done'&&stop.result.order.at(-1)===4&&stop.result.order.at(-2)===3?1:0;}});
    try{
      assert.ok(Math.abs(result.evidence-1/6)<1e-12);assert.equal(result.frontier!.outcomes.length,2);
      const checksums=new Set<number>();
      for(const row of result.frontier!.outcomes){const stop=row.current.inspect();assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Expected original callback result');assert.equal(stop.result.checksum,stop.result.order.reduce((sum,id)=>sum*7+id,0));checksums.add(stop.result.checksum);}
      assert.equal(checksums.size,2);assert.deepEqual(current.machine.storage.export(current.machine.root),before);
    }finally{for(const row of result.frontier?.outcomes??[])row.current.close();}
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

test('fixed encounter constraints reject an already-public different roster before its health product',async()=>{
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
    const machine=new CardMachine(program,privateCardGraph(program.initial(encounter)));assert.equal(machine.advance().kind,'call');const root=new ProbabilityCurrent(machine),before=machine.storage.export(machine.root);let advances=0;
    try{
      const result=conditionedNextProbabilityFrontier({representation:'exact',outcomes:[{current:root,probability:1,data:null}]},()=>null,{maximum:8,attempts:64,publications:[{kind:'discrete-result',name:'combat-roster',value:JSON.stringify(['LAGAVULIN'])}],entropy:{check(){},word(){throw Error('Contradictory roster must be pruned before any health draw');}},execute:(phase,run)=>{if(phase==='advance')advances++;return run();},likelihood:()=>{throw Error('Contradictory roster cannot reach a public outcome');}});
      assert.equal(result.frontier,null);assert.equal(result.evidence,0);assert.equal(advances,2);assert.deepEqual(machine.storage.export(machine.root),before);
      const future=nextProbability(root,null,{maximum:8,untilBoundary:'public-constraint',entropy:{check(){},word(){throw Error('No hidden draw before fixed roster');}}});
      try{
        assert.equal(future.representation,'exact');assert.equal(future.outcomes.length,1);assert.equal(future.outcomes[0]!.probability,1);
        const child=future.outcomes[0]!.current;assert.equal(child.advance(0n).kind,'chance');const conditions=child.machine.takeProbabilityPublications();
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
    const guarded=mode==='reaction'||mode==='self-removing'||mode==='scheduled'||shuffle==='discard'&&mode!=='none';
    // Each forward edge executes once; the fork keeps the same current state.
    const normal=root.fork();
    try{
      const stop=normal.machine.advance(null);assert.equal(stop.kind,'call',JSON.stringify(stop));
      const done=normal.machine.advance(null);assert.equal(done.kind,'done',JSON.stringify(done));
      if(done.kind==='done'){assert.equal(done.result.counter,1);if(mode==='reaction'||mode==='self-removing'||mode==='scheduled'||mode==='movement'&&shuffle==='discard')assert.deepEqual(done.result.seen,done.result.order);}
    }finally{normal.close();}
    let frontier:{representation:'exact'|'particles';outcomes:{current:typeof root;probability:number}[]}|undefined;
    try{
      frontier=nextProbability(root,null,{maximum:8,entropy:{check(){},word(){throw Error('Three members must remain exact');}}});
      assert.equal(frontier.representation,'exact');assert.equal(frontier.outcomes.length,6);
      for(const row of frontier.outcomes){
        const stop=row.current.inspect();assert.equal(stop.kind,'call');if(stop.kind!=='call'||stop.call.port!=='shuffled')throw Error('Expected original shuffle boundary');
        const observed=shuffleView.parse(stop.call.input);
        assert.equal(observed.resolved,guarded,`${shuffle}/${mode}`);
        const future=nextProbability(row.current,null,{maximum:8,entropy:{check(){},word(){throw Error('Three members must remain exact');}}});
        try{
          assert.equal(future.outcomes.length,guarded?1:6,`${shuffle}/${mode}`);
          for(const next of future.outcomes){const done=next.current.inspect();assert.equal(done.kind,'done');if(done.kind!=='done')throw Error('Expected result');assert.equal(done.result.counter,1);if(guarded)assert.deepEqual(done.result.order,observed.order,'retaining a callback requires retaining its original permutation');assert.deepEqual(done.result.seen,observed.seen,'an order resolution must never execute the callback again');assert.equal(done.result.calls,observed.calls);}
        }finally{for(const next of future.outcomes)next.current.close();}
      }
      assert.deepEqual(machine.storage.export(machine.root),before);
    }finally{for(const row of frontier?.outcomes??[])row.current.close();root.close();}
  }
});
