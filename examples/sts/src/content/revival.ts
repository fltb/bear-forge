import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {adventures} from '../rules/adventures.ts';
import {battles} from '../rules/battles.ts';
import {potions} from '../rules/potions.ts';
import {resources} from '../rules/resources.ts';
import {potionId} from '../identifiers.ts';
const {defineRules,defineQuery,defineEffect,sequence,when,call,query,on,install}=rules;
/** The potion revival hook also covers adventure damage, through the same HP owner. */
export const revival=defineRules({requires:[adventures,battles,potions],build(){
  const fairy=on(resources.exports.wouldDie,{condition:defineQuery({input:z.custom<rules.ReactionContext<{entity:number}>>(),output:z.boolean(),dependencies:[resources.exports.current,adventures.exports.current,adventures.exports.hasRelic,potions.exports.current],base:(r,c)=>{if(c.event.entity!==c.owner||r.query(resources.exports.current,c.owner).hp!==0||r.query(adventures.exports.hasRelic,{run:c.source,id:'MARK_OF_THE_BLOOM'}))return false;const inventory=r.query(potions.exports.current,r.query(adventures.exports.current,c.source).potions);return inventory.slots.slice(0,inventory.capacity).includes(potionId.FAIRY_POTION);}}),effect:defineEffect<rules.ReactionContext<{entity:number}>,void>(b=>{const bark=b.local<boolean>(),battle=b.local<number|null>(),amount=b.local<number>();return sequence(
    b.assign(bark,query(adventures.exports.hasRelic,{run:b.read(v=>v.input.source),id:'SACRED_BARK'})),b.assign(battle,query(battles.exports.presentForActor,b.read(v=>v.input.owner))),call(potions.exports.remove,{inventory:b.read(v=>v.get(query(adventures.exports.current,v.input.source)).potions),index:b.read(v=>v.get(query(potions.exports.current,v.get(query(adventures.exports.current,v.input.source)).potions)).slots.indexOf(potionId.FAIRY_POTION))}),
    b.assign(amount,b.read(v=>{const maxHp=v.get(query(resources.exports.current,v.input.owner)).maxHp;return Math.max(1,Math.trunc(v.get(battle)===null?(v.get(bark)?.6:Math.fround(Math.fround(maxHp)*Math.fround(.3))):Math.fround(Math.fround(maxHp)*Math.fround(v.get(bark)?.6:.3))));})),
    when(b.read(v=>v.get(battle)===null),call(resources.exports.setHealth,{entity:b.read(v=>v.input.owner),hp:amount,maxHp:b.read(v=>v.get(query(resources.exports.current,v.input.owner)).maxHp)}),call(resources.exports.heal,{entity:b.read(v=>v.input.owner),amount})),
  );})});
  const initialize=defineEffect<number,void>(b=>install({ability:fairy,source:b.input,owner:b.read(v=>v.get(query(adventures.exports.current,v.input)).actor),environment:{},lifetime:b.read(v=>v.get(query(adventures.exports.current,v.input)).scope)}));
  return{exports:{initialize}};
}});
