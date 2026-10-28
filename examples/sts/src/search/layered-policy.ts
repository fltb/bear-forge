import type {Policy} from '@bear-forge/policies';
import {serialize,deserialize} from 'node:v8';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {SearchAccounting} from '@bear-forge/policies';
import {SearchSession} from '@bear-forge/policies/search/session';
import type {SearchSessionSnapshot} from '@bear-forge/policies/search/session.types';
import {registerPolicyWork,PolicyWorkSuspended} from '@bear-forge/policies/search/work';
import {ProbabilityBudgetStopped,checkProbabilityResources} from '@bear-forge/runtime-card/probability';
import {ExactProbabilityUnavailable} from '@bear-forge/card-engine/probability-cursor';
import {compareMass,numericMass,unitMass} from '@bear-forge/card-engine/probability-mass';
import {takeStsSearchCurrent,stsExactDomain,type StsSearchCurrent,type StsCurrentSnapshot,type StsExpansionSnapshot} from './current-session.ts';
import type {StsSearchOptions} from './policy.ts';
import type {Observation} from '../game.schemas.ts';
import {publicDecision,publicKey,publicData,readVisibleEvents,actionKey} from './information.ts';
import {chooseAdventure,combatValue,combatTiePreferences} from './layered.ts';
import {describeAction} from '../presentation.ts';

type Session=SearchSession<StsSearchCurrent,StsCurrentSnapshot,StsExpansionSnapshot>;
type Saved={key:string;initial:Observation;eventOffset:number;decisionStartSteps?:bigint;search:SearchSessionSnapshot<StsCurrentSnapshot,StsExpansionSnapshot>};
type Entry={key:string;initial:Observation;eventOffset:number;decisionStartSteps:bigint;session:Session|null;saved:Uint8Array|null};
const unpackSearch=(bytes:Uint8Array):Saved['search']=>deserialize(inflateRawSync(bytes)) as Saved['search'];
const localUtility=(position:{utility?:number;priority:number})=>position.utility??(position.priority+1)/2;
function data(value:unknown):unknown{
  if(typeof value==='bigint')return value.toString();
  if(Array.isArray(value))return value.map(data);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,data(item)]));
  return value;
}
export function createLayeredPolicy(options:StsSearchOptions):Policy{
  const entries=new Map<string,Entry>(),version='sts-local-combat@1';
  const quantum=options.schedulingMilliseconds??100;
  let consumed=options.account?.milliseconds??0;
  let preparedAccounting:SearchAccounting|null=null;
  const prepare=async()=>{
    const unopened=[...entries.values()].filter(entry=>!entry.session);
    if(!unopened.length)return;
    consumed=Math.max(consumed,options.account?.milliseconds??0);
    const started=performance.now(),accounting=preparedAccounting??=new SearchAccounting();
    let actual:StsSearchCurrent|undefined;
    try{
      const requests=await accounting.measure(async()=>{
        const game=await options.forkCurrent!();
        try{
          const state=await game.inspect();if(!state.ok)throw Error(state.error.message);
          return state.value.kind==='request'?state.value.requests.map(request=>request.id):[];
        }finally{const closed=await game.close();if(!closed.ok)throw Error(closed.error.message);}
      },'current');
      // Old roots are read-only history. Keep their saved Contexts packed;
      // startup must not reconstruct every abandoned tree before serving the
      // real current request. The last accepted predecessor, if needed, is
      // attached in decide solely for the existing forward-rebase check.
      const pending=unopened.filter(entry=>{
        const identity=JSON.parse(entry.key) as {callId:string;key:string};
        return requests.some(request=>request.callId===identity.callId&&request.key===identity.key);
      });
      if(!pending.length)return;
      actual=await accounting.measure(()=>takeStsSearchCurrent(options.forkCurrent!,[]),'current');
      for(const entry of pending){
        const domain=stsExactDomain(actual.current.machine.program,entry.initial,entry.eventOffset);
        entry.session=accounting.measureSync(()=>SearchSession.restore(domain,unpackSearch(entry.saved!),'local'),'restore');entry.saved=null;
      }
    }finally{
      try{if(actual)accounting.measureSync(()=>actual!.current.close(),'cleanup');}
      finally{consumed+=performance.now()-started;if(options.account)options.account.milliseconds=consumed;}
    }
  };
  const policy:Policy={version,encoderVersion:'sts-local-board@1',async decide(input){
    const started=performance.now(),accounting=preparedAccounting??new SearchAccounting();preparedAccounting=null;let activeEntry:Entry|undefined;
    consumed=Math.max(consumed,options.account?.milliseconds??0);
    const cost=()=>accounting.cost();
    try{
      if(input.signal.aborted)throw new PolicyWorkSuspended('cancelled');
      const decision=accounting.measureSync(()=>publicDecision(input.request,input.visibleHistory),'projection');
      if(!decision.observation.battle){
        const chosen=decision.actions.length===1?{action:decision.actions[0]!,random:input.random,logProbability:0}:accounting.measureSync(()=>chooseAdventure(decision,input.random),'preference');
        const evidence=publicData({algorithm:'public-adventure',method:decision.actions.length===1?'forced-action':'layered-adventure',status:'selected',searchComplete:false});
        options.onEvidence?.({action:chosen.action,evidence,cost:cost()});
        return{action:chosen.action,nextRandom:chosen.random,nextMemory:{evidence},policyVersion:version,encoderVersion:policy.encoderVersion,logProbability:chosen.logProbability};
      }
      const key=publicKey({callId:input.request.id.callId,key:input.request.id.key,decision});
      let entry=entries.get(key);
      // Router commits nextMemory only when it accepts the proposal. It is a
      // reference to retained work, never an executable history or a Context.
      const accepted=(input.memory as {retainedSearch?:{key:string;action:string}})?.retainedSearch;
      const previous=!entry&&accepted?entries.get(accepted.key):undefined;
      // The host supplies the current decision. A warm slice already owns
      // its root; acquire a full Context only to start or attach search work.
      if(decision.actions.length>1&&(!entry||!entry.session)){
        const actual=await accounting.measure(()=>takeStsSearchCurrent(options.forkCurrent!,readVisibleEvents(input.visibleHistory)),'current');
        let owned=true;
        try{
          const retained=entry??previous;
          activeEntry=retained;
          if(retained&&!retained.session){
            const domain=stsExactDomain(actual.current.machine.program,retained.initial,retained.eventOffset);
            retained.session=accounting.measureSync(()=>SearchSession.restore(domain,unpackSearch(retained.saved!),'local'),'restore');retained.saved=null;
          }
          const previousSteps=previous?.session!.stepCount??0n;
          if(previous&&accounting.measureSync(()=>previous.session!.rebase(actual,accepted!.action),'rebase')){
            owned=false;entries.delete(previous.key);previous.key=key;previous.decisionStartSteps=previousSteps;entries.set(key,previous);entry=previous;
          }
          if(!entry&&decision.actions.length>1){
            const initial=decision.observation,eventOffset=decision.events.length;
            const domain=stsExactDomain(actual.current.machine.program,initial,eventOffset);
            const session=accounting.measureSync(()=>SearchSession.from(domain,actual,'local'),'projection');owned=false;
            entry={key,initial,eventOffset,decisionStartSteps:0n,session,saved:null};entries.set(key,entry);
          }
        }finally{if(owned)accounting.measureSync(()=>actual.current.close(),'cleanup');}
      }
      // Accepted history is already in the host record. Once the actual
      // successor is attached, release obsolete roots; only this decision's
      // unresolved future belongs to the live frontier.
      for(const [oldKey,oldEntry] of entries)if(oldEntry!==entry){
        accounting.measureSync(()=>oldEntry.session?.close(),'cleanup');entries.delete(oldKey);
      }
      activeEntry=entry;
      if(decision.actions.length===1){
        const action=decision.actions[0]!;
        const evidence=publicData({algorithm:'local-current-combat',method:'forced-action',status:'selected',searchComplete:false});
        options.onEvidence?.({action,evidence,cost:cost()});
        return{action,nextRandom:input.random,nextMemory:publicData({evidence,...(entry?{retainedSearch:{key:entry.key,action:actionKey(action)}}:{})}),policyVersion:version,encoderVersion:policy.encoderVersion,logProbability:0};
      }
      const session=entry!.session!;
      // Restoring a large retained graph is charged to total cost, but cannot
      // consume every expansion slice forever. Start this work slice only
      // once the existing current and frontier have been attached.
      const workStarted=performance.now();
      const preferences=combatTiePreferences(decision);
      const preferred=Object.entries(preferences).sort((a,b)=>b[1]-a[1])[0];
      let nextAssessment=workStarted+quantum;
      let preferredRootAction:string|undefined=preferred?.[0]??String(decision.actions[0]!.bits);
      let advanced=false,exhausted=false,iterations=0;
      for(;;){
        if(input.signal.aborted)throw new PolicyWorkSuspended('cancelled');
        checkProbabilityResources();
        if(exhausted||advanced&&performance.now()>=nextAssessment){
          const evidence=accounting.measureSync(()=>{
            const evaluate=localUtility,first=session.localEvidence(evaluate);
            const baseline=numericMass((combatValue(decision.observation,entry!.initial)+1)/2);
            // Dropping a potion has no immediate tactical benefit. Require
            // an observed compensating continuation before selecting it;
            // otherwise a deterministic discard unfairly beats an open
            // draw/use/end-turn law solely through its smaller unknown tail.
            // This is explicit heuristic selection, not a dominance proof.
            const exclusions=first.actions.flatMap(row=>{
              const action=decision.actions.find(action=>actionKey(action)===row.key)!;
              const described=describeAction(decision.observation,action.bits);
              if(described.kind==='discard-potion'&&compareMass(row.lower,baseline)<=0)
                return[{key:row.key,reason:'discard-without-observed-compensation'}];
              // A zero-energy Whirlwind must earn its use through an original
              // successor (e.g. Chemical X or another original trigger).
              // Otherwise an observed empty/self-damaging play can win solely
              // because end turn has not yet yielded its first successor.
              // This is a named local heuristic, not a no-effect proof: the
              // complete action law stays retained, and actual benefit wins.
              if(described.kind==='play-card'&&decision.observation.battle!.player.energy===0&&
                decision.observation.battle!.hand[Number(described.details.hand)]!.id==='WHIRLWIND'&&
                compareMass(row.observedSuccessorMass,unitMass())===0&&
                compareMass(row.immediateEstimate,baseline)<=0&&compareMass(row.estimate,baseline)<=0)
                return[{key:row.key,reason:'zero-energy-whirlwind-without-observed-benefit'}];
              return[];
            });
            const excluded=new Set(exclusions.map(row=>row.key));
            return{...(excluded.size?session.localEvidence(evaluate,excluded):first),
              heuristicExclusions:[...first.heuristicExclusions,...exclusions]};
          },'evidence');
          if(evidence.action){
            const published=publicData(data({algorithm:'local-current-combat',status:'estimated-action',...evidence,decisionSteps:evidence.steps-entry!.decisionStartSteps}));
            options.onEvidence?.({action:evidence.action.action,evidence:published,cost:cost()});
            return{action:evidence.action.action,nextRandom:input.random,nextMemory:{evidence:published,retainedSearch:{key:entry!.key,action:evidence.action.key}},policyVersion:version,encoderVersion:policy.encoderVersion,logProbability:null};
          }
          if(exhausted)throw new PolicyWorkSuspended('scheduling-yield');
          preferredRootAction=evidence.pendingAction??undefined;
          nextAssessment=performance.now()+quantum;
        }
        if(!accounting.measureSync(()=>session.stepLocal(preferredRootAction),'advance')){
          // A finite retained graph or a closed cycle can still provide a
          // local decision. It is not a proof of completing this combat.
          advanced=true;exhausted=true;continue;
        }
        advanced=true;
        if(++iterations%32===0)await new Promise<void>(resolve=>setImmediate(resolve));
      }
    }catch(error){
      if(error instanceof ProbabilityBudgetStopped||error instanceof ExactProbabilityUnavailable||error instanceof PolicyWorkSuspended){
        const reason=error instanceof ProbabilityBudgetStopped?'heap-pressure':error instanceof ExactProbabilityUnavailable?'exact-space-unavailable':error.reason;
        const evidence=publicData(data({algorithm:'local-current-combat',...(activeEntry?.session?.localEvidence(localUtility)??{}),status:'incomplete',action:null,reason}));
        options.onEvidence?.({action:null,evidence,cost:cost()});throw new PolicyWorkSuspended(reason);
      }
      throw error;
    }finally{consumed+=performance.now()-started;if(options.account)options.account.milliseconds=consumed;}
  }};
  registerPolicyWork(policy,{
    prepare,
    save(){return{version:1,consumed,entries:[...entries.values()].map(entry=>({key:entry.key,initial:structuredClone(entry.initial),eventOffset:entry.eventOffset,decisionStartSteps:entry.decisionStartSteps,search:entry.session?.save()??unpackSearch(entry.saved!)}))};},
    restore(value){
      const saved=value as {version:1;consumed:number;entries:Saved[]};
      const restored=new Map<string,Entry>();
      for(const entry of saved.entries){
        const decisionStartSteps=entry.decisionStartSteps??0n;
        // The actual Program is supplied later by forkCurrent. Retain all
        // saved work as detached compressed data until it can be attached,
        // rather than pinning a full decoded frontier before the host's first
        // resource check. Decoding preserves the original snapshot format.
        const packed=Uint8Array.from(deflateRawSync(serialize(entry.search),{level:1}));
        restored.set(entry.key,{key:entry.key,initial:structuredClone(entry.initial),eventOffset:entry.eventOffset,decisionStartSteps,session:null,saved:packed});
      }
      for(const [key,entry] of restored)entries.set(key,entry);
      consumed=saved.consumed;
    },
    close(){
      const errors:unknown[]=[];
      for(const entry of entries.values())try{entry.session?.close();}catch(error){errors.push(error);}
      entries.clear();if(errors.length)throw new AggregateError(errors,'Failed to release STS search sessions');
    },
  });
  return policy;
}
