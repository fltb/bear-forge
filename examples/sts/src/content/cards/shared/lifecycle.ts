import {describeProgram,programText} from './program-facts.ts';
import type {CardIdentity} from "../../../cards.ts";
import type {CardMutable,CardState,CardEvaluation,CardSetup} from "../../../rules/card-instances.types.ts";
import {rules} from '../../../rules/execution.ts';
import {z} from 'zod';
import {cardInstances} from '../../../rules/card-instances.ts';
import {cardEvaluationSchema,cardMutableSchema} from "../../../rules/card-instances.schemas.ts";
export function mutableCard(c:rules.Borrowed<CardState>):CardMutable{return{specialData:c.specialData,cost:c.cost,costForTurn:c.costForTurn,upgraded:c.upgraded,freeToPlayOnce:c.freeToPlayOnce,retain:c.retain};}
export function upgradeOnce(metadata:CardIdentity):rules.Query<CardEvaluation,boolean>{const type=metadata.type;return rules.defineQuery({input:cardEvaluationSchema,output:z.boolean(),base:(_r,c)=>type>=0&&type<=2&&!c.state.upgraded});}
export function standardUpgrade(metadata:CardIdentity):rules.Query<CardEvaluation,CardMutable>{
  const changed=metadata.variants[0].cost!==metadata.variants[1].cost,cost=metadata.variants[1].cost;
  return rules.defineQuery({input:cardEvaluationSchema,output:cardMutableSchema,base:(_r,{state:c})=>{
    if(c.upgraded)return mutableCard(c);
    return{...mutableCard(c),upgraded:true,...(changed?{cost,costForTurn:cost}:{})};
  }});
}
export function repeatedUpgrade(metadata:CardIdentity):rules.Query<CardEvaluation,CardMutable>{
  const upgrade=standardUpgrade(metadata);return rules.defineQuery({input:cardEvaluationSchema,output:cardMutableSchema,dependencies:[upgrade],base:(r,c)=>({...r.query(upgrade,c),specialData:((c.state.specialData+1)<<16)>>16})});
}
/** Reusable third-layer lifecycle hook; permanent copies carry no combat registrations. */
export function registerCardAbilities(...abilities:rules.Ability[]):rules.Effect<rules.EntityLifecycle<CardSetup>,void>{
  const enabled=rules.defineQuery({input:z.custom<{source:number;owner:number;environment:{}}>(),output:z.boolean(),dependencies:[cardInstances.exports.effectsEnabled],base:(r,c)=>r.query(cardInstances.exports.effectsEnabled,c.source)});
  const guarded=abilities.map(ability=>rules.guardAbility(ability,enabled));
  const effect:rules.Effect<rules.EntityLifecycle<CardSetup>,void>=rules.defineEffect(b=>rules.when(b.read(v=>v.input.setup.mode===1),rules.sequence(...guarded.map(ability=>rules.install({ability,source:b.read(v=>v.input.entity),owner:b.read(v=>{
    if(v.input.owner===null)throw Error('A combat card ability needs an owner');return v.input.owner;
  }),environment:{},lifetime:b.read(v=>v.input.scope)})))));
  const texts=abilities.map(programText);return texts.every(text=>text!==undefined)?describeProgram(effect,texts.join('')):effect;
}
