import type {ProbabilityCurrent} from '../../../../packages/runtime-card/src/probability.ts';
import {contract} from '../contract.ts';
import type {Ports,Frame,Action,StsEvent,Observation} from '../game.schemas.ts';
import {publicEvents,type PublicDecision} from './information.ts';
import {combatFinishedBoundary} from '../adapters/ports.ts';

type Current=ProbabilityCurrent<unknown,unknown,Ports,Frame>;

export function readStsCurrent(current:Current,events:StsEvent[],publication=false):{decision:PublicDecision;reply:(action:Action)=>unknown}{
  // Position projection consumes detached public data only. Action/reply
  // construction keeps the original active-current inspection path.
  const stop=publication?current.inspectPublication():current.inspect();
  if(stop.kind==='fault')throw Error('STS probability execution failed: '+stop.error.message);
  if(stop.kind==='chance'&&stop.space.kind==='boundary'&&stop.space.name===combatFinishedBoundary){
    const view=current.machine.probabilityBoundaryValue() as Frame;
    return{decision:{observation:contract.observe(view,'0') as Observation,actions:[],events:publicEvents(events)},reply:()=>undefined};
  }
  if(stop.kind==='done'){
    const finished=contract.finish(stop.result);
    const view=finished.view;
    return{decision:{observation:contract.observe(view,'0') as Observation,actions:[],events:publicEvents(events)},reply:()=>undefined};
  }
  const waiting=stop as Extract<ReturnType<Current['inspect']>,{kind:'call'}>;
  const port=contract.ports.decision,received=port.receive(waiting.call.input as Frame),view=received.view;
  const request=received.requests[0]!;
  const options=contract.inputs.action.describe(view,request) as {kind:'exact';values:Action[]};
  return{decision:{observation:contract.observe(view,'0') as Observation,actions:options.values,events:publicEvents(events)},reply(action){
    return (port.respond(view,request,action) as {valid:true;output:unknown}).output;
  }};
}
