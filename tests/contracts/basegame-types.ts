import { z } from 'zod';
import type {
  BaseGame, DecisionId, GameModule, DecisionPolicy, QueryCall, GameInput, DescribeChoice,
  CompiledProgram, StateTransition, StateConstruction, Evaluation,
  Encoding, FactExtraction, StateResources, PortBindings,
} from '@bear-forge/contracts';
import { game } from '../../games/doudizhu/src/index.ts';
import type { DouDizhuTypes, DouDizhuPorts } from '../../games/doudizhu/src/index.ts';

type Interactions = {
  bid: { request: { minimum: number }; input: { amount: number }; description: never };
  text: { request: null; input: string; description: { grammar: 'expression' } };
};
type Queries = { count: { input: null; output: number }; label: { input: number; output: string } };
type B = BaseGame<Interactions, string, { at: number }, { timeout: string }, string, { hand: number[] }, string, number, Queries>;
export async function consume(base:B, decisionId:DecisionId) {
  const options=await base.describe({decisionId,choiceId:'bidder',type:'bid'});
  if(options.ok){ const amount:number=options.value.values[0]!.amount;void amount; }
  const expression=await base.describe({decisionId,choiceId:'expression',type:'text'});
  if(expression.ok&&expression.value.kind==='construct'){
    const grammar:'expression'=expression.value.description.grammar;void grammar;
  }
  const count=await base.query({name:'count',args:null});
  if(count.ok){const n:number=count.value;void n;}
  await base.bind({onDecision:async()=>({kind:'reply',value:{kind:'choice',choiceId:'bidder',input:{type:'bid',value:{amount:2}},delivery:{at:0}}})});
  await base.bind({onDecision:async()=>({kind:'reply',value:{kind:'signal',signal:{timeout:'bidder'}}})});
  await base.run({limits:{maxInputs:1}});
  // @ts-expect-error no generic context filter
  const badDescribe:DescribeChoice<Interactions>={decisionId,choiceId:'bidder',type:'bid',context:{actor:'x'}};
  void badDescribe;
  // @ts-expect-error input template and payload remain correlated
  await base.bind({onDecision:async()=>({kind:'reply',value:{kind:'choice',choiceId:'bidder',input:{type:'text',value:{amount:2}},delivery:{at:0}}})});
  // @ts-expect-error query payload cannot be swapped
  await base.query({name:'count',args:3});
}
export function widened(name:'count'|'label') {
  // @ts-expect-error whole argument correlation survives a widened key
  const call:QueryCall<Queries>={name,args:null};void call;
}
export function wrongModule(module:GameModule<DouDizhuTypes,{}>) {
  // @ts-expect-error missing a port's declared output schema
  module.program.schemas.ports.decision={input:z.never()};
  // @ts-expect-error game author receives only IO, no ambient random/state capability
  module.program.run=async(setup,io)=>{await io.integer({minInclusive:0,maxExclusive:2});return game.program.run(setup,io);};
}
type NeverSignal=GameInput<Interactions,null,never>;
// @ts-expect-error absent session signals are uninhabited
const signal:NeverSignal={kind:'signal',signal:null};void signal;
export function variance(narrow:CompiledProgram<{x:1},DouDizhuPorts,number>) {
  // @ts-expect-error artifact association is invariant
  const wider:CompiledProgram<{x:number},DouDizhuPorts,number>=narrow;void wider;
}
// The neutral capabilities can be used with an integer state; no players or payoff vector required.
export async function neutral(
  transition:StateTransition<number,string,boolean>,resources:StateResources<number>,
  construct:StateConstruction<string,null,number,number>,evaluation:Evaluation<number,null,number>,
  encoding:Encoding<number,number[]>,facts:FactExtraction<number,null,string>,
) {
  const root=await construct.construct({source:'visible',config:null,entropy:3});
  const child=await transition.transition({state:root,input:'move'});
  await transition.inspect(child.state);await evaluation.evaluate({source:child.state,config:null});
  await encoding.encode(child.state);await facts.extract({source:child.state,config:null});
  await resources.release([root,child.state]);
}
export function bindings(binding:PortBindings<DouDizhuPorts>) {
  // @ts-expect-error raw callback must return the port output, not an unrelated domain action
  binding.decision=async()=>({kind:'pass'});
}


import type { BaseGameBinder, GameHandle, LoadedCore, NativeCoreLoader, ControlledCoreLoader, CompiledProgram as Artifact } from '@bear-forge/contracts';
type DDZ = GameHandle<DouDizhuTypes,{}>;
export async function actualBinding(
  binder:BaseGameBinder,
  core:LoadedCore<DouDizhuTypes['setup'],DouDizhuPorts,DouDizhuTypes['programResult']>,
  native:NativeCoreLoader,
  controlled:ControlledCoreLoader,
  artifact:Artifact<DouDizhuTypes['setup'],DouDizhuPorts,DouDizhuTypes['programResult']>,
) {
  const nativeLoaded=await native.load(game.program);
  if(nativeLoaded.ok){const loaded:typeof core=nativeLoaded.value;void loaded;}
  const controlledLoaded=await controlled.load(artifact);
  if(controlledLoaded.ok){const loaded:typeof core=controlledLoaded.value;void loaded;}
  const started=await core.core.start({game:{profile:'competitive-2016-bear-1',firstBidder:'0',initialGameTime:0},seed:12});
  if(!started.ok)return;
  const bound=await binder.bind({instance:started.value,contract:game.contract,...(core.persistence?{persistence:core.persistence}:{})});
  if(!bound.ok)return;
  const base:DDZ=bound.value;
  if(core.capture)await core.capture.read(base.id,{after:null,limit:10});
  try {
    if(base.fork){
      const child=await base.fork();
      if(child.ok){
        const sameType:DDZ=child.value;
        try { await sameType.observe({observer:'0'});await walk(sameType,2,0); }
        finally { await sameType.close(); }
      }
    }
    if(base.save&&core.persistence){
      const saved=await base.save();
      if(saved.ok){
        try {
          const instance=await core.persistence.restore(saved.value);
          if(instance.ok){
            const restored=await binder.bind({instance:instance.value,contract:game.contract,persistence:core.persistence});
            if(restored.ok)await restored.value.close();
          }
        }finally{await core.persistence.release(saved.value);}
      }
    }
  }finally{await base.close();if(core.capture)await core.capture.release(base.id);}
  // @ts-expect-error setup retains the game's declared rule profile
  await core.core.start({game:{profile:'unregistered',firstBidder:'0',initialGameTime:0},seed:12});
  // @ts-expect-error binding requires a real Instance, not a Core or a module
  await binder.bind({core, module:game});
}
export function directPlay(base:Omit<B,'fork'|'save'>):B { return base; }
export async function removedSurfaces(base:B) {
  // @ts-expect-error BaseGame has exactly one driving entrypoint: run
  base.submit;
  // @ts-expect-error no separate state-transition facade
  base.branching;
  // @ts-expect-error queries are on the same facade
  base.queries;
  // @ts-expect-error the bound Instance is the only read target
  await base.inspect({kind:'current'});
}
// Search owns traversal; every child uses the exact ordinary play API.
export async function walk(base:DDZ,depth:number,receivedAtGameTime:number):Promise<void> {
  let read=await base.inspect();if(!read.ok)throw read.error;
  if(read.value.kind==='event'){
    const drained=await base.run({limits:{maxInputs:0}});if(!drained.ok)throw drained.error;
    if(drained.value.kind==='fault')throw drained.value.error;
    read=await base.inspect();if(!read.ok)throw read.error;
    if(read.value.kind==='event')throw new Error('event callback paused search branch');
  }
  if(depth<=0||read.value.kind!=='decision')return;
  if(!base.fork)throw new Error('fork required');
  for(const choice of read.value.choices){
    const options=await base.describe({decisionId:read.value.decisionId,choiceId:choice.id,type:choice.type});
    if(!options.ok)throw options.error;
    for(const action of options.value.values){
      const forked=await base.fork();if(!forked.ok)throw forked.error;
      const child=forked.value;
      try {
        const boundary=await child.inspect();if(!boundary.ok)throw boundary.error;
        if(boundary.value.kind!=='decision')throw new Error('fork changed boundary');
        // Read the child identity; parent credentials must never be submitted to it.
        const input={kind:'choice' as const,choiceId:choice.id,input:{type:'action' as const,value:action},delivery:{receivedAtGameTime}};
        const accepted=await child.validate({decisionId:boundary.value.decisionId,input});
        if(!accepted.ok)throw accepted.error;
        if(!accepted.value.valid)continue;
        const expected=boundary.value.decisionId;
        const bound=await child.bind({onDecision:async(request)=>{
          if(request.decisionId.instanceId!==expected.instanceId||request.decisionId.callId!==expected.callId)return {kind:'pause'};
          return {kind:'reply',value:input};
        }});if(!bound.ok)throw bound.error;
        const stopped=await child.run({limits:{maxInputs:1}});if(!stopped.ok)throw stopped.error;
        if(stopped.value.kind==='fault')throw stopped.value.error;
        if(stopped.value.acceptedInputs!==1)throw new Error('search input was not accepted');
        await walk(child,depth-1,receivedAtGameTime);
      } finally { const closed=await child.close();if(!closed.ok)throw closed.error; }
    }
  }
}

// Trusted session/router consumes batches; individual policies receive only one actor offer.
export async function callbackPlay(base:DDZ, policy:DecisionPolicy<DouDizhuTypes['interactions'],DouDizhuTypes['actor'],DouDizhuTypes['observation']>) {
  const abort=new AbortController();
  await base.bind({
    async onDecision(request,control) {
      if(control.signal.aborted)return {kind:'pause'};
      const offer=request.offers[0];if(!offer)return {kind:'pause'};
      const ownHand:number[]=offer.observation.observation.hand;
      void ownHand;
      const selected=await policy(offer,control);if(selected.kind==='pause')return selected;
      return {kind:'reply',value:{kind:'choice',choiceId:offer.choice.id,input:{type:'action',value:selected.value},delivery:{receivedAtGameTime:0}}};
    },
    async onEvent(delivery) {
      const event:DouDizhuTypes['event']=delivery.event;void event;
      return {kind:'reply',value:null};
    },
  });
  const stopped=await base.run({limits:{maxInputs:1},signal:abort.signal});
  if(stopped.ok&&stopped.value.kind==='paused')await base.inspect();
  // @ts-expect-error event acknowledgment cannot become a game action
  await base.bind({onEvent:async()=>({kind:'reply',value:{kind:'pass'}})});
  // @ts-expect-error undeclared host callbacks are not protocol fields
  await base.bind({randomInteger:async()=>3});
  await base.bind(null);
}

// Terminal and decision projections cannot introduce a second event delivery channel.
import type { DecisionData, TerminalData, GameRunStop } from '@bear-forge/contracts';
export function eventBoundaryOnly(decision:DecisionData<DouDizhuTypes>,terminal:TerminalData<DouDizhuTypes>) {
  // @ts-expect-error notifications belong to event ports
  decision.events;
  // @ts-expect-error terminal results have no pending notifications
  terminal.events;
  // @ts-expect-error a completed game cannot also be paused waiting for delivery
  const stopped:GameRunStop<Interactions,string,number>={acceptedInputs:0,kind:'paused',reason:'requested',boundary:{kind:'ended',result:0}};
  void stopped;
}
