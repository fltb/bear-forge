import type {GameHandle} from '@bear-forge/contracts/loading';
import type {SearchCurrent, SearchSuccessor} from '@bear-forge/policies';
import {SearchStopped} from '@bear-forge/policies';
import type {StsTypes} from '../contract.ts';
import type {StsEvent} from '../game.schemas.ts';
import {publicEvents, actionKey, type PublicDecision} from './information.ts';
import {position} from './evaluation.ts';

const unwrap=<T>(result:{ok:true;value:T}|{ok:false;error:unknown}):T=>{
  if(!result.ok)throw Error('STS continuation failure: '+JSON.stringify(result.error));
  return result.value;
};

/** Retains an owned branch of the actual current Context with all continuation
 * state intact. No historical reconstruction or masking of the root. This
 * adapter currently advances concrete outcomes; probabilistic treatment of
 * unrevealed futures must be integrated before enabling player search. */
export function createStsContinuation(signal:AbortSignal) {
  type Held={game:GameHandle<StsTypes>;events:StsEvent[];decision:PublicDecision;round:number;closed:boolean;expanded:boolean};
  const held=new WeakMap<SearchCurrent,Held>();
  async function read(game:GameHandle<StsTypes>,events:StsEvent[]):Promise<PublicDecision>{
    const state=unwrap(await game.inspect());
    if(state.kind==='fault')throw Error('STS production fault: '+JSON.stringify(state.error));
    if(state.kind==='ended')return{observation:unwrap(await game.observe({player:'0'})),actions:[],events:publicEvents(events)};
    if(state.kind!=='request'||state.requests.length!==1)throw Error('Expected stable STS decision');
    const request=state.requests[0]!;
    if(request.player!=='0'||request.type!=='action'||request.options.kind!=='exact')throw Error('Unsupported STS action domain');
    return{observation:request.observation,actions:request.options.values,events:publicEvents(events)};
  }
  async function take(game:GameHandle<StsTypes>,visibleEvents:readonly StsEvent[],round=0):Promise<SearchCurrent>{
    try{
      const events=structuredClone([...visibleEvents]),decision=await read(game,events);
      const data:Held={game,events,decision,round,closed:false,expanded:false};
      const current:SearchCurrent={position:{...position(decision),round},async close(){if(data.closed)return;data.closed=true;unwrap(await game.close());}};
      held.set(current,data);return current;
    }catch(error){unwrap(await game.close());throw error;}
  }
  async function* next(current:SearchCurrent):AsyncGenerator<SearchSuccessor,void,void>{
    const parent=held.get(current);
    if(!parent||parent.closed||parent.expanded)throw Error('Current is foreign, closed, or already expanded');
    parent.expanded=true;
    for(const action of parent.decision.actions){
      if(signal.aborted)throw new SearchStopped('cancelled');
      if(!parent.game.fork)throw Error('STS current has no fork capability');
      const game=unwrap(await parent.game.fork()),events=structuredClone(parent.events);
      let transferred=false;
      try{
        let supplied=false;
        unwrap(await game.bind({player:'0',onRequest:async request=>{
          if(supplied)return{kind:'pause'};
          if(request.options.kind!=='exact'||!request.options.values.some(a=>actionKey(a)===actionKey(action)))throw Error('Branch action identity changed');
          supplied=true;return{kind:'reply',value:action};
        },onEvent:async delivery=>{events.push(structuredClone(delivery.event));return{kind:'reply',value:null};}}));
        const result=unwrap(await game.run({signal}));
        if(result.state.kind==='fault')throw Error('STS production fault: '+JSON.stringify(result.state.error));
        if(signal.aborted)throw new SearchStopped('cancelled');
        if(!result.accepted||result.accepted.kind!=='action'||actionKey(result.accepted.reply.action)!==actionKey(action))throw Error('STS successor did not accept exactly its candidate action');
        const decision=await read(game,events);
        const before=parent.decision.observation,after=decision.observation;
        const rounds=parent.round+(before.game.floor===after.game.floor?Math.max(0,(after.battle?.turn??0)-(before.battle?.turn??0)):Number(before.battle!==null));
        // take() owns cleanup even if reading/validating the new current fails.
        transferred=true;
        const child=await take(game,events,rounds);
        yield{action:actionKey(action),outcomes:[{current:child,probability:1}],representation:'exact'};
      }finally{if(!transferred)unwrap(await game.close());}
    }
  }
  return{take,next};
}
