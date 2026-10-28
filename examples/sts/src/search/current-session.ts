import {serialize,deserialize} from 'node:v8';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {type CardProgram} from '@bear-forge/card-engine';
import type {GameHandle} from '@bear-forge/contracts/loading';
import {forkGameCurrent} from '@bear-forge/game-host/current';
import {ProbabilityCurrent,takeProbabilityCurrent,restoreProbabilityCurrent,type StoredProbabilitySnapshot} from '@bear-forge/runtime-card/probability';
import {ProbabilityExpansion,type ProbabilityExpansionSnapshot} from '@bear-forge/runtime-card/probability-expansion';
import type {ExactDomain,ExactExpansion} from '@bear-forge/policies/search/session.types';
import {contract,type StsTypes} from '../contract.ts';
import type {Ports,Frame,StsEvent,Observation} from '../game.schemas.ts';
import {readStsCurrent} from './probability-current.ts';
import {combatUpper,exactCombatPosition} from './combat-objective.ts';
import {combatFinishedBoundary,stsPorts} from '../adapters/ports.ts';
import {adventures} from '../rules/adventures.ts';
import {inspectRuleQuery} from '@bear-forge/card-engine/rules-inspection';
import {combatValue} from './layered.ts';
import {publicKey,compressedPublicKey} from './information.ts';

type Current=ProbabilityCurrent<unknown,unknown,Ports,Frame>;
export type StsSearchCurrent={current:Current;events:StsEvent[]};
// Strings contain the entire V8 event graph, losslessly compressed. Old array
// snapshots remain readable. They are storage, never executable history.
type StoredEvents=StsEvent[]|string;
type EventData={events:StoredEvents};
export type StsCurrentSnapshot=StoredProbabilitySnapshot<unknown>&EventData;
export type StsExpansionSnapshot=ProbabilityExpansionSnapshot<unknown,EventData,StoredProbabilitySnapshot<unknown>>;
export type StsExactDomain=ExactDomain<StsSearchCurrent,StsCurrentSnapshot,StsExpansionSnapshot>;

const encodeEvents=(events:StsEvent[])=>deflateRawSync(serialize(events),{level:1}).toString('base64');
function decodeEvents(stored:StoredEvents):StsEvent[]{
  return typeof stored==='string'?deserialize(inflateRawSync(Buffer.from(stored,'base64'))):stored;
}
// Public callers can still obtain and mutate an owned event array. Internal
// reads decode transient data without retaining an object graph per current.
const histories=new WeakMap<StsSearchCurrent,{packed:string;exposed?:StsEvent[]}>();
function eventCurrent(current:Current,packed:string):StsSearchCurrent{
  const history:{packed:string;exposed?:StsEvent[]}={packed};
  const node={current,get events(){return history.exposed??=decodeEvents(history.packed);},set events(value:StsEvent[]){history.exposed=value;}};
  histories.set(node,history);return node;
}
function currentEvents(node:StsSearchCurrent):StsEvent[]{
  const history=histories.get(node);return history?history.exposed??decodeEvents(history.packed):node.events;
}
function storedEvents(node:StsSearchCurrent):string{
  const history=histories.get(node);return history&&!history.exposed?history.packed:encodeEvents(currentEvents(node));
}

/** A detached fork of the actual waiting Context, never an observation-built
 * root. The original host keeps its real current; search owns the returned one. */
export async function takeStsSearchCurrent(source:()=>Promise<GameHandle<StsTypes>>,events:readonly StsEvent[]):Promise<StsSearchCurrent>{
  const game=await source();let current:Current|undefined;
  try{
    current=await takeProbabilityCurrent<Ports,Frame>(await forkGameCurrent(game));
    return eventCurrent(current,encodeEvents([...events]));
  }catch(error){current?.close();throw error;}
  finally{const closed=await game.close();if(!closed.ok){current?.close();throw Error(closed.error.message);}}
}

/** Probability operations, contract replies and event delivery all use their
 * production paths. This adapter only retains their current execution state. */
export function stsExactDomain(program:CardProgram<unknown,unknown,Ports,Frame>,initial:Observation,eventOffset:number):StsExactDomain{
  // A projection depends on the complete original current and event data.
  // Keep an immutable parked witness, not the caller's mutable owner. Digests
  // only select candidates; sameCurrent still proves full data/anchor equality.
  // No cached reply or transition is executed, and the current initial-state
  // preference is recomputed outside this cache on every position request.
  // Retain losslessly compressed public data, not another object graph for
  // every event history. Cache hits decode detached values; misses return the
  // already detached original projection. Full Context witnesses still prove
  // reuse, and compressed event keys preserve every public field.
  type Projection={key:string;witness:Current;decision:Buffer};
  const projections=new Map<string,Set<Projection>>(),ownedProjections=new WeakMap<StsSearchCurrent,Projection>();
  const releaseProjection=(node:StsSearchCurrent)=>{
    const row=ownedProjections.get(node);if(!row)return;
    ownedProjections.delete(node);const bucket=projections.get(row.key)!;bucket.delete(row);if(!bucket.size)projections.delete(row.key);
    row.witness.close();
  };
  const project=(node:StsSearchCurrent)=>{
    const events=currentEvents(node),key=node.current.candidateKey()+':'+compressedPublicKey(events),bucket=projections.get(key);
    if(bucket)for(const row of bucket)if(row.witness.sameCurrent(node.current))return deserialize(inflateRawSync(row.decision)) as ReturnType<typeof readStsCurrent>['decision'];
    const decision=readStsCurrent(node.current,events,true).decision;
    node.current.park();const witness=node.current.fork();
    try{
      releaseProjection(node);
      const row={key,witness,decision:deflateRawSync(serialize(decision),{level:1})},target=projections.get(key)??new Set<Projection>();
      target.add(row);projections.set(key,target);ownedProjections.set(node,row);return decision;
    }catch(error){witness.close();throw error;}
  };
  const options={stopAtBoundary:combatFinishedBoundary,continueCall:(stop:Extract<ReturnType<Current['inspect']>,{kind:'call'}>,data:EventData)=>{
    if(stop.call.port!=='event')return undefined;
    const delivery=contract.ports.event.receive(stop.call.input);
    const events=decodeEvents(data.events);
    for(const raw of delivery.events){const visible=contract.projectEvent(raw,'0');if(visible)events.push(visible.event);}
    return{reply:delivery.output,data:{events:encodeEvents(events)}};
  }};
  let run:number|undefined;
  const prefixUtility=(current:Current)=>{
    try{
      const stop=current.inspectExact();
      if(stop.kind==='done'||stop.kind==='call'&&stop.call.port==='decision'||
        stop.kind==='chance'&&stop.space.kind==='boundary'&&stop.space.name===combatFinishedBoundary){
        return(combatValue(readStsCurrent(current,[]).decision.observation,initial)+1)/2;
      }
      // Original event callbacks and instruction yields can occur halfway
      // through scope cleanup. They do not publish a complete board. Keep
      // that mass unknown with its source prior; do not invent a partial view.
      if(stop.kind!=='chance'||stop.space.kind==='boundary')return undefined;
      const definition=current.machine.program.definition,state=current.machine.root.state;
      run??=inspectRuleQuery(definition,state,adventures.exports.instances,undefined)[0]!;
      // The same original public projection reads already executed changes.
      // No reply/action, random resolution, alternate card model or player
      // decision is created at this private instruction/chance boundary.
      const frame=inspectRuleQuery(definition,state,stsPorts.exports.frame,{run,actions:[],selection:null});
      return(combatValue(contract.observe(frame,'0') as Observation,initial)+1)/2;
    }finally{current.park();}
  };
  const wrap=(expansion:ProbabilityExpansion<unknown,unknown,Ports,Frame,EventData>):ExactExpansion<StsSearchCurrent,StsExpansionSnapshot>=>({
    get complete(){return expansion.complete;},get delivered(){return expansion.delivered;},
    localFrontier:()=>expansion.readFrontier(prefixUtility).flatMap(row=>row.value===undefined?[]:[{mass:row.mass,utility:row.value}]),
    step:()=>expansion.step(),take(){const row=expansion.take();return row?{current:eventCurrent(row.current,typeof row.data.events==='string'?row.data.events:encodeEvents(row.data.events)),mass:row.mass}:undefined;},
    save:()=>expansion.savePacked(),close:()=>expansion.close(),
  });
  return{upper:combatUpper,
    position:node=>{try{return exactCombatPosition(project(node),initial,eventOffset);}finally{node.current.park();}},
    // Event data also affects future observable identities. Do not equate
    // histories merely because the current public decision looks the same.
    equivalent:(left,right)=>publicKey(currentEvents(left))===publicKey(currentEvents(right))&&left.current.sameCurrent(right.current),
    next(node,key){
      try{
      const view=readStsCurrent(node.current,currentEvents(node)),action=view.decision.actions.find(action=>String(action.bits)===key);
      return wrap(ProbabilityExpansion.from<unknown,unknown,Ports,Frame,EventData>(node.current,view.reply(action!),{events:storedEvents(node)},options));
      }finally{node.current.park();}
    },
    save(node){return{...node.current.packedSnapshot(),events:storedEvents(node)};},
    restore(stored){const packed=typeof stored.events==='string'?stored.events:encodeEvents(stored.events);return eventCurrent(restoreProbabilityCurrent(program,stored),packed);},
    restoreExpansion(saved){
      const pack=<T extends {data:EventData}>(row:T):T=>{
        return{...row,data:{events:typeof row.data.events==='string'?row.data.events:encodeEvents(row.data.events)}};
      };
      return wrap(ProbabilityExpansion.restore(program,{...saved,pending:saved.pending.map(pack),ready:saved.ready.map(pack)},options));
    },
    close:node=>{releaseProjection(node);node.current.close();},
  };
}
