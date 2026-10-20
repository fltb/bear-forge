import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {adventures} from '../rules/adventures.ts';
import {potions} from '../rules/potions.ts';
import {resources} from '../rules/resources.ts';
import {adventureChoices} from './sts-ports.ts';
import {adventureDraws} from './adventure-draws.ts';
import {potionId,eventId} from '../identifiers.ts';
const {defineRules,defineQuery,defineEffect,sequence,when,forEach,call,query,modify,on,install}=rules;
export const adventurePotions=defineRules({requires:[adventureChoices,adventureDraws],build(){
  const options=modify(adventureChoices.exports.additional,{condition:defineQuery({input:z.custom<rules.ModifierContext<number,number[]>>(),output:z.boolean(),base:(_r,c)=>c.input===c.owner}),dependencies:[adventures.exports.current,potions.exports.current],transform:(r,c)=>{
    const run=r.query(adventures.exports.current,c.input);if(run.screen==='EVENT_SCREEN'&&run.event===eventId.WE_MEET_AGAIN)return c.value;const s=r.query(potions.exports.current,run.potions),out=[...c.value];for(let index=0;index<s.capacity;index++){
      const id=s.slots[index];if(id===potionId.EMPTY_POTION_SLOT||id===potionId.INVALID)continue;
      if(id===potionId.BLOOD_POTION||id===potionId.FRUIT_JUICE||id===potionId.ENTROPIC_BREW)out.push((0x80000000|index)>>>0);out.push((0xc0000000|index)>>>0);
    }return out;
  }});
  const drink=defineEffect<{run:number;bits:number},void>(b=>{const potion=b.local<number>(),drawn=b.local<number>(),bark=b.local<boolean>();return sequence(
    b.assign(potion,call(potions.exports.remove,{inventory:b.read(v=>v.get(query(adventures.exports.current,v.input.run)).potions),index:b.read(v=>v.input.bits&255)})),when(b.read(v=>!!(v.input.bits&0x40000000)),b.return(undefined)),b.assign(bark,query(adventures.exports.hasRelic,{run:b.read(v=>v.input.run),id:'SACRED_BARK'})),
    when(b.read(v=>v.get(potion)===potionId.BLOOD_POTION),call(resources.exports.heal,b.read(v=>{const entity=v.get(query(adventures.exports.current,v.input.run)).actor;return{entity,amount:Math.trunc(Math.fround(Math.fround(v.get(query(resources.exports.current,entity)).maxHp)*Math.fround(v.get(bark)?.4:.2)))};})),
      when(b.read(v=>v.get(potion)===potionId.FRUIT_JUICE),call(resources.exports.raiseMaxHp,{entity:b.read(v=>v.get(query(adventures.exports.current,v.input.run)).actor),amount:b.read(v=>v.get(bark)?10:5)}),
        when(b.read(v=>v.get(potion)===potionId.ENTROPIC_BREW),forEach(b.read(v=>Array.from({length:v.get(query(potions.exports.current,v.get(query(adventures.exports.current,v.input.run)).potions)).capacity},(_,index)=>index)),index=>sequence(b.assign(drawn,call(adventureDraws.exports.rewardPotion,b.read(v=>v.get(query(adventures.exports.current,v.input.run)).streams.potion))),when(b.read(v=>v.get(query(potions.exports.current,v.get(query(adventures.exports.current,v.input.run)).potions)).slots[v.get(index)]===potionId.EMPTY_POTION_SLOT),call(potions.exports.fillAt,{inventory:b.read(v=>v.get(query(adventures.exports.current,v.input.run)).potions),index,potion:drawn})))),b.return(b.read(()=>{throw Error('Potion cannot be drunk outside combat');}))))),
  );});
  const consumed=on(adventureChoices.exports.accepted,{condition:defineQuery({input:z.custom<rules.ReactionContext<{run:number;bits:number}>>(),output:z.boolean(),base:(_r,c)=>c.event.run===c.owner&&!!(c.event.bits&0x80000000)}),effect:defineEffect<rules.ReactionContext<{run:number;bits:number}>,void>(b=>call(drink,b.read(v=>v.input.event)))});
  const initialize=defineEffect<number,void>(b=>sequence(...[options,consumed].map(ability=>install({ability,source:b.input,owner:b.input,environment:{},lifetime:b.read(v=>v.get(query(adventures.exports.current,v.input)).scope)}))));
  return{exports:{initialize,drink}};
}});
