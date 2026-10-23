import {fairyPotionHealing} from '../content/potions/vitality.ts';
import { typedValue } from '../rules/value.schemas.ts';
import {z} from 'zod';
import {rules} from '../rules/execution.ts';
import {adventures} from "../rules/adventures.ts";
import {battles} from "../rules/battles.ts";
import {potions} from "../rules/potions.ts";
import {resources} from "../rules/resources.ts";
import {potionId} from "../identifiers.ts";
const {defineRules,defineQuery,defineEffect,sequence,when,call,query,on,install}=rules;
/** The potion revival hook also covers adventure damage, through the same HP owner. */
export const revival=defineRules({requires:[adventures,battles,potions],build(){
  const fairy=on(resources.exports.wouldDie,{condition:defineQuery({input:typedValue<rules.ReactionContext<{entity:number}>>(),output:z.boolean(),dependencies:[resources.exports.current,adventures.exports.current,adventures.exports.hasRelic,potions.exports.current,adventures.exports.bindings,resources.exports.vitality],base:(r,c)=>{if(c.event.entity!==c.owner||r.query(resources.exports.vitality,c.owner).hp!==0||r.query(adventures.exports.hasRelic,{run:c.source,id:'MARK_OF_THE_BLOOM'}))return false;const inventory=r.query(potions.exports.current,r.query(adventures.exports.bindings,c.source).potions);return inventory.slots.slice(0,inventory.capacity).includes(potionId.FAIRY_POTION);}}),effect:defineEffect<rules.ReactionContext<{entity:number}>,void>(b=>{const bark=b.local<boolean>(),battle=b.local<number|null>(),amount=b.local<number>();return sequence(
    b.assign(bark,query(adventures.exports.hasRelic,{run:b.read(v=>v.input.source),id:'SACRED_BARK'})),b.assign(battle,query(battles.exports.presentForActor,b.read(v=>v.input.owner))),call(potions.exports.remove,{inventory:b.read(v=>v.query(adventures.exports.bindings,v.input.source).potions),index:b.read(v=>v.query(potions.exports.current,v.query(adventures.exports.bindings,v.input.source).potions).slots.indexOf(potionId.FAIRY_POTION))}),
    b.assign(amount,b.read(v=>{const maxHp=v.query(resources.exports.vitality,v.input.owner).maxHp;return fairyPotionHealing(maxHp,v.get(bark),v.get(battle)!==null);})),
    when(b.read(v=>v.get(battle)===null),call(resources.exports.setHealth,{entity:b.read(v=>v.input.owner),hp:amount,maxHp:b.read(v=>v.query(resources.exports.vitality,v.input.owner).maxHp)}),call(resources.exports.heal,{entity:b.read(v=>v.input.owner),amount})),
  );})});
  const initialize=defineEffect<number,void>(b=>install({ability:fairy,source:b.input,owner:b.read(v=>v.query(adventures.exports.bindings,v.input).actor),environment:{},lifetime:b.read(v=>v.query(adventures.exports.bindings,v.input).scope)}));
  return{exports:{initialize}};
}});
