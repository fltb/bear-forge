import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {battles} from '../../../../rules/battles.ts';
import {damage} from '../../../../rules/damage.ts';
import {entityId} from '../../../../rules/resources.schemas.ts';

export type Lightning = {battle:number;owner:number;base:number;exclude:number|null};
export type LightningReceipt = Lightning & {amount:number;targets:number[]};
const request=z.object({battle:entityId,owner:entityId,base:z.int32().nonnegative(),exclude:entityId.nullable()});
const receipt=request.extend({amount:z.int32().nonnegative(),targets:z.array(entityId)});

/** Character content composed through ordinary queries, effects and events.
 * One batch is one strike, including a fully blocked strike; an empty batch is none.
 * The existing damage pipeline still owns block, prevention, limits and death.
 */
export const lightning=rules.defineRules({requires:[battles,damage],build(m){
  const amount=rules.defineQuery({input:request,output:z.int32().nonnegative(),base:(_r,i)=>i.base});
  const settled=m.own(rules.defineEvent({payload:receipt,dispatch:'immediate'}));
  const announce=m.atom({input:receipt,output:z.undefined(),reads:[],writes:[],emits:[settled],run(_r,payload){
    return {writes:[],events:[{event:settled,payload}],result:undefined};
  }});
  const strike=rules.defineEffect<Lightning,void>(b=>{
    const targets=b.local<number[]>(),value=b.local<number>();
    return rules.sequence(
      b.assign(targets,b.read(v=>v.get(rules.query(battles.exports.targets,v.input.battle)).filter(id=>id!==v.input.exclude))),
      rules.when(b.read(v=>v.get(targets).length===0),b.return(undefined)),
      b.assign(value,rules.query(amount,b.input)),
      rules.forEach(targets,target=>rules.call(damage.exports.hit,{
        battle:b.read(v=>v.input.battle),source:b.read(v=>v.input.owner),target,amount:value,attack:false,selfDamage:false,
      })),
      rules.call(announce,b.read(v=>({...v.input,amount:v.get(value),targets:v.get(targets)}))),
      rules.call(battles.exports.checkOutcome,b.read(v=>v.input.battle)),
    );
  });
  return {exports:{amount,strike,settled:settled.public}};
}});
