import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CardMachine,CardProgram,linkRules,type CardDefinition} from '@bear-forge/card-engine';
import {privateCardGraph} from '@bear-forge/runtime-card/graph';
import {inspectRuleQuery} from '@bear-forge/card-engine/rules-inspection';
import {ProbabilityCurrent} from '@bear-forge/runtime-card/probability';
import {ProbabilityExpansion} from '@bear-forge/runtime-card/probability-expansion';
import {addMass,multiplyMass,unitMass,zeroMass,type ProbabilityMass} from '@bear-forge/card-engine/probability-mass';
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
type Frontier={outcomes:{current:Current;mass:ProbabilityMass}[]};
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
const frontier=(current:Current):Frontier=>({outcomes:[{current,mass:unitMass()}]});
const close=(value:Frontier)=>{for(const row of value.outcomes)row.current.close();};
function saveFrontier(source:Frontier){return{outcomes:source.outcomes.map(row=>({context:row.current.machine.storage.export(row.current.machine.root),mass:row.mass}))};}
function restoreFrontier(program:CardProgram<{},RestSetup,Ports,Frame>,saved:ReturnType<typeof saveFrontier>):Frontier{
  return{outcomes:saved.outcomes.map(row=>{program.validate(row.context);return{current:new ProbabilityCurrent(new CardMachine(program,privateCardGraph(row.context))),mass:row.mass};})};
}
const options={continueCall(stop:Extract<ReturnType<Current['inspect']>,{kind:'call'}>,data:null){return stop.call.port==='event'?{reply:contract.ports.event.receive(stop.call.input).output,data}:undefined;}};
function expand(current:Current,action:Action){
  const received=contract.ports.decision.receive(frame(current)),request=received.requests[0]!;
  const prepared=contract.ports.decision.respond(received.view,request,action);
  if(!prepared.valid)throw Error(prepared.reason);
  return ProbabilityExpansion.from(current,prepared.output,null,options);
}
// Used for the finite deterministic rest/selection examples below. Random
// rewards keep their live expansion instead of demanding a materialized list.
function step(source:Frontier,action:Action):Frontier{
  const result:Frontier={outcomes:[]};
  try{
    for(const parent of source.outcomes){
      const expansion=expand(parent.current,action);
      try{for(;;){const row=expansion.take();if(row)result.outcomes.push({current:row.current,mass:multiplyMass(parent.mass,row.mass)});
        else if(expansion.complete)break;else expansion.step();}}
      finally{expansion.close();}
    }
    assert.deepEqual(result.outcomes.reduce((sum,row)=>addMass(sum,row.mass),zeroMass()),unitMass());return result;
  }catch(error){close(result);throw error;}
}
function withoutInitialization(run:()=>void){
  const initial=CardProgram.prototype.initial;
  CardProgram.prototype.initial=function(){throw Error('Rest continuation must not initialize or replay');};
  try{run();}finally{CardProgram.prototype.initial=initial;}
}

for(const character of ['ironclad','volibear'] as const){
  test(`${character}: original rest healing and red key produce isolated successors`,()=>{
    const root=fixture(character,['REGAL_PILLOW']),before=saveFrontier(frontier(root));
    try{withoutInitialization(()=>{
      for(const bits of [0,2]){
        const next=step(frontier(root),{bits});
        try{
          assert.equal(next.outcomes.length,1);assert.deepEqual(next.outcomes[0]!.mass,unitMass());
          const after=frame(next.outcomes[0]!.current);
          assert.equal(after.game.screen,'MAP_SCREEN');assert.equal(after.game.hp,bits===0?57:20);
          assert.equal(after.game.keys.red,bits===2);assert.deepEqual(after.game.deck,frame(root).game.deck);
          assert.deepEqual(after.history,[{kind:'game',bits}]);
        }finally{close(next);}
      }
      assert.deepEqual(saveFrontier(frontier(root)),before);
    });}finally{root.close();}
  });

  test(`${character}: original smith selection resumes from its saved current exactly once`,()=>{
    const root=fixture(character),before=saveFrontier(frontier(root));
    try{withoutInitialization(()=>{
      const nested=step(frontier(root),{bits:1});
      try{
        assert.equal(nested.outcomes.length,1);const current=nested.outcomes[0]!.current,selection=frame(current);
        assert.equal(selection.game.select?.type,3);assert.ok(selection.game.select!.cards.length>0);
        assert.deepEqual(selection.history,[{kind:'game',bits:1}]);
        const picked=selection.game.select!.cards[0]!,action=selection.actions[0]!,saved=saveFrontier(nested);
        // Destroy the original nested Context; restoration must use only the
        // saved current frames, including the unfinished room caller.
        close(nested);
        const restored=restoreFrontier(root.machine.program,saved);
        try{
          assert.deepEqual(saveFrontier(restored),saved);
          const done=step(restored,action);
          try{
            assert.equal(done.outcomes.length,1);const after=frame(done.outcomes[0]!.current);
            assert.equal(after.game.screen,'MAP_SCREEN');assert.equal(after.game.hp,20);
            assert.equal(after.history.length,2);assert.deepEqual(after.history[1],{kind:'game',bits:action.bits});
            assert.deepEqual(after.game.deck,frame(root).game.deck.map((card,index)=>index===picked.deckIndex?{...card,upgraded:true}:card));
          }finally{close(done);}
        }finally{close(restored);}
        assert.deepEqual(saveFrontier(frontier(root)),before);
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
    const root=fixture(character,[relic]),before=saveFrontier(frontier(root));
    try{withoutInitialization(()=>{
      let expansion=expand(root,{bits:relic==='SHOVEL'?5:0});
      try{
        expansion.step();const saved=expansion.save();expansion.close();expansion=ProbabilityExpansion.restore(root.machine.program,saved,options);
        const rewards=new Set<string>();
        // Inspect distinct delivered rewards, retaining every unvisited branch
        // and its mass. Two observations are a test assertion, not a world cap.
        while(rewards.size<2){
          const row=expansion.take();
          if(!row){assert.equal(expansion.complete,false);expansion.step();continue;}
          try{
            const after=frame(row.current);assert.equal(after.game.screen,'REWARDS');
            assert.equal(after.game.hp,relic==='SHOVEL'?20:42);
            assert.deepEqual(after.game.deck,frame(root).game.deck);assert.ok(after.actions.length>1);
            if(relic==='SHOVEL')assert.equal(after.game.rewards!.relics.length,1);
            else{assert.equal(after.game.rewards!.cards.length,1);assert.equal(after.game.rewards!.cards[0]!.length,3);}
            assert.ok(row.mass.numerator>0n);rewards.add(JSON.stringify(after.game.rewards));
          }finally{row.current.close();}
          const mass=expansion.masses();assert.deepEqual(addMass(addMass(mass.pending,mass.ready),mass.transferred),unitMass());
        }
        const mass=expansion.masses();assert.ok(mass.pending.numerator+mass.ready.numerator>0n,'unvisited rewards remain represented');
        assert.deepEqual(saveFrontier(frontier(root)),before);
      }finally{expansion.close();}
    });}finally{root.close();}
  });
}
