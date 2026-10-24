import type {GameHandle} from '@bear-forge/contracts/loading';
import type {SearchCurrent,SearchSuccessor,SearchExpansion,SearchBudget} from '@bear-forge/policies';
import {SearchStopped} from '@bear-forge/policies';
import {forkGameCurrent} from '../../../../packages/game-host/src/current.ts';
import {takeProbabilityCurrent,nextProbabilityFrontier,ProbabilityBudgetStopped,type ProbabilityCurrent,type ProbabilityFrontier} from '../../../../packages/runtime-card/src/probability.ts';
import {contract,type StsTypes} from '../contract.ts';
import type {Ports,Frame,Action,StsEvent} from '../game.schemas.ts';
import {publicEvents,actionKey,type PublicDecision} from './information.ts';
import {position} from './evaluation.ts';

type Current=ProbabilityCurrent<unknown,unknown,Ports,Frame>;
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
function stop(error:unknown,budget:SearchBudget):never{
  if(error instanceof ProbabilityBudgetStopped){budget.reason=error.reason;throw new SearchStopped(error.reason);}
  throw error;
}

/** This adapter supplies probability execution to the search, using the exact
 * production contract for observation, candidate identity, replies and events.
 * It contains no card/enemy/mechanism interpretation or settlement. */
export function createStsProbabilityContinuation(){
  type Data={events:StsEvent[]};
  type Frontier=ProbabilityFrontier<unknown,unknown,Ports,Frame,Data>;
  type Held={current:Current;frontier:Frontier;decision:PublicDecision;round:number;closed:boolean;expanded:boolean};
  const held=new WeakMap<SearchCurrent,Held>();
  function read(current:Current,events:StsEvent[]):{decision:PublicDecision;reply:(action:Action)=>unknown}{
    const stop=current.inspect();
    if(stop.kind==='fault')throw Error('STS probability execution failed: '+stop.error.message);
    if(stop.kind==='done'){
      const finished=contract.finish(stop.result);contract.schemas.result.parse(finished.result);
      const view=contract.schemas.view.parse(finished.view);
      return{decision:{observation:contract.schemas.observation.parse(contract.observe(view,'0')),actions:[],events:publicEvents(events)},reply(){throw Error('Terminal current has no action');}};
    }
    if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected a stable STS decision');
    const port=contract.ports.decision,received=port.receive(stop.call.input),view=contract.schemas.view.parse(received.view);
    const request=received.requests[0];
    if(received.requests.length!==1||!request||request.player!=='0'||request.type!=='action')throw Error('Unsupported STS request domain');
    contract.schemas.actions.action.request.parse(request.data);
    const options=contract.inputs.action.options.parse(contract.inputs.action.describe(view,request));
    if(options.kind!=='exact')throw Error('Unsupported STS candidate domain');
    return{decision:{observation:contract.schemas.observation.parse(contract.observe(view,'0')),actions:options.values,events:publicEvents(events)},reply(action){
      const parsed=contract.schemas.actions.action.action.parse(action),prepared=port.respond(view,request,parsed);
      if(!prepared.valid)throw Error('Illegal STS search reply: '+prepared.reason);
      return prepared.output;
    }};
  }
  function hold(current:Current,data:Data,round?:number):SearchCurrent{
    try{
      const decision=read(current,data.events).decision,publicPosition=position(decision),currentRound=round??publicPosition.round;
      const source:Frontier={representation:'exact',outcomes:[{current,probability:1,data}]};
      const state:Held={current,frontier:source,decision,round:currentRound,closed:false,expanded:false};
      const result:SearchCurrent={position:{...publicPosition,round:currentRound},async close(){if(!state.closed){state.closed=true;current.close();}}};
      held.set(result,state);return result;
    }catch(error){current.close();throw error;}
  }
  /** A thunk lets the adapter charge the host fork before allocating it. An
   * already-owned branch remains supported for internal callers and tests. */
  async function take(source:GameHandle<StsTypes>|(()=>Promise<GameHandle<StsTypes>>),events:readonly StsEvent[],budget:SearchBudget):Promise<SearchCurrent>{
    let game=typeof source==='function'?undefined:source;
    let root:Current|undefined;
    try{
      try{
        if(typeof source==='function'){budget.allocateNode();game=await budget.segment(source,'fork');}
        // One host Context fork, then one owned probability Context fork.
        budget.allocateNode();budget.allocateNode();
        root=await budget.segment(async()=>takeProbabilityCurrent<Ports,Frame>(await forkGameCurrent(game!)),'fork');
      }finally{if(game)await budget.measure(async()=>{unwrap(await game!.close());},'cleanup');}
      budget.check();
      return budget.measureSync(()=>{
        const data:Data={events:structuredClone([...events])};
        // The current enemy intent is explicitly authorized knowledge. Keep
        // its original state and execute the original action; future random
        // choices still pass through the probability kernel in next().
        return hold(root!,data);
      },'projection');
    }catch(error){root?.close();stop(error,budget);}
  }

  async function* next(source:SearchCurrent,expansion:SearchExpansion):AsyncGenerator<SearchSuccessor,void,void>{
    const parent=held.get(source),{budget}=expansion;
    if(!parent||parent.closed||parent.expanded)throw Error('Current is foreign, closed, or already expanded');
    parent.expanded=true;
    const entropy={word:()=>expansion.word(),check:()=>budget.check()};
    const execute=<T>(phase:'fork'|'advance'|'cleanup',operation:()=>T):T=>{
      if(phase==='fork')budget.allocateNode();else if(phase==='advance')budget.check();
      return budget.measureSync(operation,phase);
    };
    for(const action of parent.decision.actions){
      budget.check();
      const outcomes:SearchSuccessor['outcomes']=[],owned=new Set<Current>();
      try{
        const result=nextProbabilityFrontier(
          parent.frontier,
          (current,data)=>budget.measureSync(()=>read(current,data.events).reply(action),'projection'),
          {maximum:budget.limits.worlds,entropy,execute,continueCall:(stop,data)=>{
            if(stop.call.port!=='event')return undefined;
            const input=stop.call.input;
            return budget.measureSync(()=>{
              const delivery=contract.ports.event.receive(input);
              for(const raw of delivery.events){
                const event=contract.schemas.event.parse(raw),visible=contract.projectEvent(event,'0');
                if(visible){const event=contract.schemas.playerEvent.parse(visible.event);data.events.push(event);}
              }
              return{reply:delivery.output,data};
            },'projection');
          }},
        );
        // Acquire the entire batch before projection can fail. Event calls
        // have already continued each retained Context through the same kernel.
        for(const node of result.outcomes)owned.add(node.current);
        for(const node of result.outcomes){
          budget.check();
          const child=budget.measureSync(()=>{
            const after=read(node.current,node.data.events).decision.observation,before=parent.decision.observation;
            const round=parent.round+(before.game.floor===after.game.floor?Math.max(0,(after.battle?.turn??0)-(before.battle?.turn??0)):Number(before.battle!==null));
            return hold(node.current,node.data,round);
          },'projection');
          outcomes.push({current:child,probability:node.probability});
        }
        budget.check();owned.clear();
        yield{action:actionKey(action),outcomes,representation:result.representation};
      }catch(error){stop(error,budget);}
      finally{for(const current of owned)execute('cleanup',()=>current.close());}
    }
  }
  return{take,next,representation(current:SearchCurrent){const state=held.get(current);if(!state||state.closed)throw Error('Current is foreign or closed');return state.frontier.representation;}};
}
