import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CardMachine,CardProgram,linkRules,type CardDefinition} from '@bear-forge/card-engine';
import {SearchBudget,defaultSearchLimits} from '@bear-forge/policies';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {inspectRuleQuery} from '../../../packages/card-engine/src/rules-inspection.ts';
import {ProbabilityCurrent,nextProbabilityFrontier,saveProbabilityFrontier,restoreProbabilityFrontier,type ProbabilityFrontier} from '../../../packages/runtime-card/src/probability.ts';
import {searchEntropyWord} from '../../../packages/policies/src/search/entropy.ts';
import {rules} from '../src/rules/execution.ts';
import {adventures} from '../src/rules/adventures.ts';
import {resources} from '../src/rules/resources.ts';
import {rooms} from '../src/rules/rooms.ts';
import {adventureStart} from '../src/program/start.ts';
import {adventureContent} from '../src/program/adventure.ts';
import {volibearAdventureCatalog} from '../src/program/volibear.ts';
import {volibearContent} from '../src/program/volibear-content.ts';
import {startingRelics} from '../src/content/characters/ironclad/relics/burning-blood.ts';
import {stsPorts} from '../src/adapters/ports.ts';
import {contract} from '../src/contract.ts';
import {programSchemas,type Setup,type Ports,type Frame,type Action} from '../src/game.schemas.ts';
import type {RelicId} from '../src/identifiers.ts';

type RestSetup=Setup&{owned:RelicId[];red:boolean};
type Current=ProbabilityCurrent<{},RestSetup,Ports,Frame>;
type Frontier=ProbabilityFrontier<{},RestSetup,Ports,Frame,null>;
const {defineEffect,sequence,call,query,forEach}=rules;
const programs=new Map<string,CardProgram<{},RestSetup,Ports,Frame>>();
const definitions=new WeakMap<object,CardDefinition<{},RestSetup,Ports,Frame>>();

/** Directed room entry through original owner operations and the original REST
 * definition. It initializes once; it is not an adventure or a restored path. */
function restProgram(character:'ironclad'|'volibear'){
  const cached=programs.get(character);if(cached)return cached;
  const start=character==='volibear'?volibearContent.start:adventureStart;
  const module=rules.defineRules({requires:[start,adventureContent.rooms,adventureContent.cards,adventureContent.acquisition,stsPorts,volibearContent.cards,volibearContent.hearts,volibearContent.history],build(){
    const catalog=character==='volibear'?volibearAdventureCatalog:{starterRelic:startingRelics.exports.BurningBlood,cardPools:adventureContent.cards.exports.cardPools,cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions};
    const rest=adventureContent.rooms.exports.definitions.find(row=>row.key==='REST')!.definition;
    const entry=defineEffect<RestSetup,Frame>(b=>{const run=b.local<number>(),room=b.local<number>();return sequence(
      b.assign(run,call(start.exports.initialize,{setup:b.read(v=>({seed:v.input.seed,character:v.input.character})),definition:rules.defineEntity(adventures.exports.kind,catalog)})),
      call(stsPorts.exports.initialize,run),
      ...(character==='volibear'?[call(volibearContent.history.exports.initialize,run)]:[]),
      forEach(b.read(v=>v.input.owned),id=>call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id})})),
      call(resources.exports.setHealth,b.read(v=>({entity:v.query(adventures.exports.bindings,v.get(run)).actor,hp:20,maxHp:75}))),
      call(adventures.exports.setKeys,{run,keys:{red:b.read(v=>v.input.red),green:false,blue:false}}),
      call(adventures.exports.setRoom,{run,room:'REST',event:0}),
      b.assign(room,rules.spawnEntity({kind:rooms.exports.kind,definition:rest,owner:run,scope:b.read(v=>v.query(adventures.exports.bindings,v.get(run)).scope),setup:{run}})),
      rules.despawnEntity({entity:room,reason:{roomComplete:true}}),
      call(stsPorts.exports.flush,run),b.return(query(stsPorts.exports.frame,{run,actions:[],selection:null})),
    );});return{exports:{entry}};
  }});
  const definition=linkRules<{},RestSetup,Ports,Frame>({id:`sts/rest-probability/${character}`,schemas:{...programSchemas,setup:programSchemas.setup.extend({owned:z.array(z.custom<RelicId>()),red:z.boolean()})},initialize:()=>({}),entry:module.exports.entry,definitions:[module.exports.entry],modules:[module]});
  const program=new CardProgram(definition);programs.set(character,program);definitions.set(program,definition);return program;
}
function fixture(character:'ironclad'|'volibear',owned:RelicId[]=[],red=false){
  const program=restProgram(character),machine=new CardMachine(program,privateCardGraph(program.initial({seed:'130',character,owned,red})));
  try{
    let stop=machine.advance();
    while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(contract.ports.event.receive(stop.call.input).output);
    if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected original rest request: '+JSON.stringify(stop));
    assert.equal(stop.call.input.game.screen,'REST_ROOM');
    return new ProbabilityCurrent(machine);
  }catch(error){machine.storage.close?.();throw error;}
}
function frame(current:Current):Frame{
  const stop=current.inspect();
  if(stop.kind==='done')return stop.result;
  if(stop.kind==='call'&&stop.call.port==='decision')return stop.call.input;
  throw Error('Expected public boundary: '+JSON.stringify(stop));
}
const frontier=(current:Current):Frontier=>({representation:'exact',outcomes:[{current,probability:1,data:null}]});
const close=(value:Frontier)=>{for(const row of value.outcomes)row.current.close();};
function step(source:Frontier,action:Action):Frontier{
  const budget=new SearchBudget({...defaultSearchLimits,mode:'work'},new AbortController().signal);
  let random={state:76,position:0};
  return nextProbabilityFrontier(source,current=>{
    const before=frame(current),received=contract.ports.decision.receive(before),request=received.requests[0]!;
    const prepared=contract.ports.decision.respond(received.view,request,action);
    if(!prepared.valid)throw Error(prepared.reason);return prepared.output;
  },{maximum:budget.limits.worlds,entropy:{check:()=>budget.check(),word(){const draw=searchEntropyWord(random);random=draw.random;return draw.value;}},
    execute(phase,operation){if(phase==='fork')budget.allocateNode();return budget.measureSync(operation,phase);},
    continueCall(stop,data){return stop.call.port==='event'?{reply:contract.ports.event.receive(stop.call.input).output,data}:undefined;},
  });
}
function withoutInitialization(run:()=>void){
  const initial=CardProgram.prototype.initial;
  CardProgram.prototype.initial=function(){throw Error('Rest continuation must not initialize or replay');};
  try{run();}finally{CardProgram.prototype.initial=initial;}
}

for(const character of ['ironclad','volibear'] as const){
  test(`${character}: original rest healing and red key produce isolated successors`,()=>{
    const root=fixture(character,['REGAL_PILLOW']),before=saveProbabilityFrontier(frontier(root));
    try{withoutInitialization(()=>{
      for(const bits of [0,2]){
        const next=step(frontier(root),{bits});
        try{
          assert.equal(next.representation,'exact');assert.equal(next.outcomes.length,1);assert.equal(next.outcomes[0]!.probability,1);
          const after=frame(next.outcomes[0]!.current);
          assert.equal(after.game.screen,'MAP_SCREEN');assert.equal(after.game.hp,bits===0?57:20);
          assert.equal(after.game.keys.red,bits===2);assert.deepEqual(after.game.deck,frame(root).game.deck);
          assert.deepEqual(after.history,[{kind:'game',bits}]);
        }finally{close(next);}
      }
      assert.deepEqual(saveProbabilityFrontier(frontier(root)),before);
    });}finally{root.close();}
  });

  test(`${character}: original smith selection resumes from its saved current exactly once`,()=>{
    const root=fixture(character),before=saveProbabilityFrontier(frontier(root));
    try{withoutInitialization(()=>{
      const nested=step(frontier(root),{bits:1});
      try{
        assert.equal(nested.outcomes.length,1);const current=nested.outcomes[0]!.current,selection=frame(current);
        assert.equal(selection.game.select?.type,3);assert.ok(selection.game.select!.cards.length>0);
        assert.deepEqual(selection.history,[{kind:'game',bits:1}]);
        const picked=selection.game.select!.cards[0]!,action=selection.actions[0]!,saved=saveProbabilityFrontier(nested);
        // Destroy the original nested Context; restoration must use only the
        // saved current frames, including the unfinished room caller.
        close(nested);
        const restored=restoreProbabilityFrontier(root.machine.program,saved);
        try{
          assert.deepEqual(saveProbabilityFrontier(restored),saved);
          const done=step(restored,action);
          try{
            assert.equal(done.outcomes.length,1);const after=frame(done.outcomes[0]!.current);
            assert.equal(after.game.screen,'MAP_SCREEN');assert.equal(after.game.hp,20);
            assert.equal(after.history.length,2);assert.deepEqual(after.history[1],{kind:'game',bits:action.bits});
            assert.deepEqual(after.game.deck,frame(root).game.deck.map((card,index)=>index===picked.deckIndex?{...card,upgraded:true}:card));
          }finally{close(done);}
        }finally{close(restored);}
        assert.deepEqual(saveProbabilityFrontier(frontier(root)),before);
      }finally{close(nested);}
    });}finally{root.close();}
  });

  test(`${character}: original relic restrictions retain the sole leave action`,()=>{
    const root=fixture(character,['COFFEE_DRIPPER','FUSION_HAMMER'],true);
    try{withoutInitialization(()=>{
      assert.deepEqual(frame(root).actions,[{bits:6}]);
      const next=step(frontier(root),{bits:6});
      try{assert.equal(next.outcomes.length,1);const after=frame(next.outcomes[0]!.current);assert.equal(after.game.screen,'MAP_SCREEN');assert.equal(after.game.hp,20);assert.deepEqual(after.game.deck,frame(root).game.deck);}finally{close(next);}
    });}finally{root.close();}
  });

  test(`${character}: original Girya and Peace Pipe keep their own current semantics`,()=>{
    const root=fixture(character,['GIRYA','PEACE_PIPE']);
    try{withoutInitialization(()=>{
      assert.ok(frame(root).actions.some(action=>action.bits===3));assert.ok(frame(root).actions.some(action=>action.bits===4));
      for(const bits of [3,4]){
        const next=step(frontier(root),{bits});
        try{
          assert.equal(next.outcomes.length,1);const after=frame(next.outcomes[0]!.current);
          assert.equal(after.game.screen,'MAP_SCREEN');assert.deepEqual(after.game.deck,frame(root).game.deck);
          assert.equal(after.game.relics.find(relic=>relic.id==='GIRYA')!.data,bits===3?1:0);
          // Original Peace Pipe prepares a selection only. The probability
          // path must not add a card removal or another interactive window.
          if(bits===4){
            assert.equal(after.game.select,undefined,'selection metadata is not published on the map screen');
            const machine=next.outcomes[0]!.current.machine;
            const definition=definitions.get(machine.program)!;
            const runs=inspectRuleQuery(definition,machine.root.state,adventures.exports.instances,undefined);
            assert.equal(runs.length,1);
            const prepared=inspectRuleQuery(definition,machine.root.state,adventures.exports.selection,runs[0]!).selection;
            assert.equal(prepared.type,4);assert.equal(prepared.count,1);assert.ok(prepared.cards.length>0);assert.deepEqual(prepared.selected,[]);
          }
        }finally{close(next);}
      }
    });}finally{root.close();}
  });

  for(const relic of ['DREAM_CATCHER','SHOVEL'] as const)test(`${character}: ${relic} reaches weighted original reward windows from current`,()=>{
    const root=fixture(character,[relic]),before=saveProbabilityFrontier(frontier(root));
    try{withoutInitialization(()=>{
      const next=step(frontier(root),{bits:relic==='SHOVEL'?5:0});
      try{
        assert.equal(next.representation,'particles');assert.ok(next.outcomes.length>1&&next.outcomes.length<=8);
        assert.ok(Math.abs(next.outcomes.reduce((sum,row)=>sum+row.probability,0)-1)<1e-12);
        const rewards=new Set<string>();
        for(const row of next.outcomes){
          const after=frame(row.current);assert.equal(after.game.screen,'REWARDS');
          assert.equal(after.game.hp,relic==='SHOVEL'?20:42);
          assert.deepEqual(after.game.deck,frame(root).game.deck);assert.ok(after.actions.length>1);
          if(relic==='SHOVEL')assert.equal(after.game.rewards!.relics.length,1);
          else{assert.equal(after.game.rewards!.cards.length,1);assert.equal(after.game.rewards!.cards[0]!.length,3);}
          rewards.add(JSON.stringify(after.game.rewards));
        }
        assert.ok(rewards.size>1);assert.deepEqual(saveProbabilityFrontier(frontier(root)),before);
      }finally{close(next);}
    });}finally{root.close();}
  });
}
