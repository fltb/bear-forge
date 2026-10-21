import type {CardMetadata} from "../../../cards.ts";
import type {CardMutable,CardState,CardEvaluation,CardSetup} from "../../../rules/card-instances.types.ts";
import {rules} from '@bear-forge/card-engine';
import {z} from 'zod';
import {cardEvaluationSchema,cardMutableSchema} from "../../../rules/card-instances.schemas.ts";
export function mutableCard(c:Readonly<CardState>):CardMutable{return{specialData:c.specialData,cost:c.cost,costForTurn:c.costForTurn,upgraded:c.upgraded,freeToPlayOnce:c.freeToPlayOnce,retain:c.retain};}
export function upgradeOnce(metadata:CardMetadata):rules.Query<CardEvaluation,boolean>{const type=metadata.type;return rules.defineQuery({input:cardEvaluationSchema,output:z.boolean(),base:(_r,c)=>type>=0&&type<=2&&!c.state.upgraded});}
export function standardUpgrade(metadata:CardMetadata):rules.Query<CardEvaluation,CardMutable>{
  const changed=metadata.variants[0].cost!==metadata.variants[1].cost,cost=metadata.variants[1].cost;
  return rules.defineQuery({input:cardEvaluationSchema,output:cardMutableSchema,base:(_r,{state:c})=>{
    if(c.upgraded)return mutableCard(c);
    return{...mutableCard(c),upgraded:true,...(changed?{cost,costForTurn:cost}:{})};
  }});
}
export function repeatedUpgrade(metadata:CardMetadata):rules.Query<CardEvaluation,CardMutable>{
  const upgrade=standardUpgrade(metadata);return rules.defineQuery({input:cardEvaluationSchema,output:cardMutableSchema,dependencies:[upgrade],base:(r,c)=>({...r.query(upgrade,c),specialData:((c.state.specialData+1)<<16)>>16})});
}
/** Reusable third-layer lifecycle hook; permanent copies carry no combat registrations. */
export function registerCardAbilities(...abilities:rules.Ability[]):rules.Effect<rules.EntityLifecycle<CardSetup>,void>{
  return rules.defineEffect(b=>rules.when(b.read(v=>v.input.setup.mode===1),rules.sequence(...abilities.map(ability=>rules.install({ability,source:b.read(v=>v.input.entity),owner:b.read(v=>{
    if(v.input.owner===null)throw Error('A combat card ability needs an owner');return v.input.owner;
  }),environment:{},lifetime:b.read(v=>v.input.scope)})))));
}
