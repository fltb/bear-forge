import {CardMachine,type CardProgram,type CardRoot,type CardStop,type CardTrace} from '@bear-forge/card-engine';
import type {PortShape} from '@bear-forge/contracts/core';
import type {ProbabilityYield} from '../../card-engine/src/probability.ts';
import {validateScheduledContext,ruleContextIdentityEpoch} from '../../card-engine/src/card.ts';
import {CardGraph,privateCardGraph} from './graph.ts';

type Phase='advance'|'publish'|'ready';
export type ScheduledSnapshot<S>={kernel:'original';rule:string;root:CardRoot<S>;immutable:readonly object[];nullPrototypes:readonly object[];contextValues:readonly object[];phase:Phase};

/** One accepted reply (or initial continuation), driven through the original
 * interpreter. A quantum yields scheduling only. No probability replacement,
 * historical replies, or rule evaluation occurs during save/restore.
 * This is private kernel work; it does NOT snapshot the enclosing Controller,
 * GameHost or policy transaction, nor constitute a public Instance snapshot. */
export class ScheduledAdvance<S,Setup,P extends {[K in keyof P]:PortShape},R>{
  readonly machine:CardMachine<S,Setup,P,R>;
  private phase:Phase='advance';
  private reply:unknown;
  private started=false;
  private published:CardStop<P,R>|undefined;
  constructor(machine:CardMachine<S,Setup,P,R>,reply:unknown=undefined){
    if(machine.root.stop?.kind==='chance')throw Error('Original execution cannot consume a probability current');
    if(machine.root.stop?.kind==='yield'&&reply!==undefined)throw Error('Original continuation takes no new reply');
    this.machine=machine;this.reply=reply;
  }
  get ready(){return this.phase==='ready';}
  get publicationPending(){return this.phase==='publish';}
  current():CardStop<P,R>{
    if(!this.ready)throw Error('Original continuation has no published IO');
    return this.published??=this.machine.current();
  }
  step(instructions:number):CardStop<P,R>|ProbabilityYield{
    if(!Number.isSafeInteger(instructions)||instructions<1)throw Error('Invalid instruction slice');
    if(this.ready)return this.current();
    let stop:CardStop<P,R>|ProbabilityYield;
    if(this.phase==='publish'){
      // An earlier advance committed before export/collection failed. Retry
      // ONLY publication of that current, without resending its consumed reply.
      stop=this.machine.root.stop?.kind==='yield'?{kind:'yield'}:this.machine.current();
    }else{
      stop=this.machine.advanceScheduled(this.reply,instructions,()=>{
        this.started=true;this.reply=undefined;this.phase='publish';
      });
    }
    if(stop.kind==='yield'){this.phase='advance';return stop;}
    this.published=stop;this.phase='ready';return stop;
  }
  save():ScheduledSnapshot<S>{
    if(!this.started)throw Error('No committed original continuation to save');
    if(!(this.machine.storage instanceof CardGraph))throw Error('Original continuation requires controlled storage to save');
    const graph=this.machine.storage.snapshot(false,ruleContextIdentityEpoch(this.machine.program));validateScheduledContext(this.machine.program,graph.root);
    if(this.phase==='advance'&&graph.root.stop.kind!=='yield')throw Error('Unconsumed original reply cannot be saved as a continuation');
    return{kernel:'original',rule:this.machine.program.definition.id,root:graph.root,immutable:graph.immutable,nullPrototypes:graph.nullPrototypes,contextValues:graph.contextValues,phase:this.phase};
  }
  /** Adopt an already admitted owned Context with a new host trace binding.
   * This does not initialize, export or advance the underlying machine. */
  static adopt<S,Setup,P extends {[K in keyof P]:PortShape},R>(machine:CardMachine<S,Setup,P,R>,phase:Phase):ScheduledAdvance<S,Setup,P,R>{
    const kind=machine.root.stop?.kind;
    if(!['advance','publish','ready'].includes(phase)||!['yield','call','done'].includes(kind)||
      phase==='advance'&&kind!=='yield'||phase==='ready'&&kind==='yield')throw Error('Original continuation phase disagrees with Context');
    const work=new ScheduledAdvance(machine);work.started=true;work.phase=phase;return work;
  }
  static restore<S,Setup,P extends {[K in keyof P]:PortShape},R>(program:CardProgram<S,Setup,P,R>,saved:ScheduledSnapshot<S>,trace?:(event:CardTrace)=>void):ScheduledAdvance<S,Setup,P,R>{
    if(!saved||saved.kernel!=='original'||saved.rule!==program.definition.id||!Array.isArray(saved.immutable)||!Array.isArray(saved.nullPrototypes)||!Array.isArray(saved.contextValues)||!['advance','publish','ready'].includes(saved.phase))throw Error('Invalid original continuation snapshot');
    validateScheduledContext(program,saved.root);
    if(saved.phase==='advance'&&saved.root.stop.kind!=='yield'||saved.phase==='ready'&&saved.root.stop.kind==='yield')throw Error('Original continuation phase disagrees with Context');
    const storage=program.definition.project?new CardGraph(saved.root,saved.immutable,saved.nullPrototypes,saved.contextValues):privateCardGraph(saved.root,saved.immutable,saved.nullPrototypes,saved.contextValues);
    return ScheduledAdvance.adopt(new CardMachine(program,storage,trace),saved.phase);
  }
}
