import {volibearS2Powers} from './powers/s2.ts';
import {volibearThunderGuard} from './mechanics/thunder-guard.ts';
import {PS,MS} from '../../../combat-identifiers.ts';
import {statusTexts} from '../../powers/descriptions.ts';
import {volibearNextAttack} from './mechanics/next-attack.ts';
import {volibearNextPlayDiscount} from './mechanics/next-play-discount.ts';
import {volibearRepeat} from './mechanics/repeat.ts';
import {volibearEngagePreparation} from './mechanics/engage-preparation.ts';
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {volibearDomain} from './mechanics/domain.ts';
import {volibearTraining} from './mechanics/training.ts';
import {stormCharge} from './mechanics/storm-charge.ts';
import {lightning} from './mechanics/lightning.ts';
import {volibearDamageTraining} from './mechanics/damage-training.ts';
import {powers} from '../../../rules/powers.ts';
import {battles} from '../../../rules/battles.ts';
/** Character-specific public data, composed into STS's existing observation. */
export const volibearPresentation=rules.defineRules({requires:[volibearS2Powers,volibearThunderGuard,lightning,stormCharge,volibearDamageTraining,volibearNextAttack,volibearNextPlayDiscount,volibearRepeat,volibearEngagePreparation,volibearDomain,volibearTraining,powers,battles],build(){
  const effects=rules.defineQuery({input:z.object({battle:z.number(),enemies:z.array(z.number().nullable())}),output:z.array(z.object({actor:z.number(),target:z.string(),name:z.string(),text:z.string(),level:z.number(),active:z.boolean()})),dependencies:[volibearS2Powers.exports.effects,volibearThunderGuard.exports.active,stormCharge.exports.current,battles.exports.status,powers.exports.entries,powers.exports.current,powers.exports.display,powers.exports.presentation],base:(r,input)=>{
    const board=r.query(battles.exports.status,input.battle);
    const entries=r.query(powers.exports.entries,board.registry).flatMap(entry=>{
      const custom=r.query(powers.exports.display,entry.entity),state=r.query(powers.exports.current,entry.entity),p=r.query(powers.exports.presentation,entry.entity);
      const enemyIndex=input.enemies.indexOf(state.actor);
      if(state.phase!==1||state.actor!==board.actor&&enemyIndex<0)return[];
      const name=p?Object.entries(state.actor===board.actor?PS:MS).find(([,key])=>key===p.key)?.[0]:undefined;
      const display=custom??(name&&statusTexts[name]?{name,text:statusTexts[name]}:null);
      if(!display)return[];
      return[{...display,actor:state.actor,target:state.actor===board.actor?'player':'enemy:'+enemyIndex,level:state.level,active:state.active}];
    });
    const charge=r.query(stormCharge.exports.current,input.battle);
    entries.push({name:'雷势',text:stormCharge.exports.text+lightning.exports.chargeText,level:charge.amount,actor:board.actor,target:'player',active:true});
    entries.push({name:'本回合雷伤次数',text:'每段完整雷伤结算计1次，全体雷伤同样计1次。',level:charge.strikes,actor:board.actor,target:'player',active:true});
    for(const power of r.query(volibearS2Powers.exports.effects,input.battle))entries.push({name:power.name,text:power.text,level:power.level,actor:power.owner,target:'player',active:true});
    for(const guard of r.query(volibearThunderGuard.exports.active,input.battle))entries.push({name:'雷霆护身',text:volibearThunderGuard.exports.text,level:guard.amount,actor:guard.owner,target:'player',active:true});
    return entries;
  }});
  const domain=rules.defineQuery({input:z.number(),output:z.object({active:z.boolean(),untilTurn:z.number().nullable()}),dependencies:[volibearDomain.exports.current,volibearDomain.exports.active],base:(r,battle)=>({active:r.query(volibearDomain.exports.active,battle),untilTurn:r.query(volibearDomain.exports.current,battle)?.until??null})});
  const permanentBonus=rules.defineQuery({input:z.number(),output:z.number(),dependencies:[volibearTraining.exports.permanentBonus,volibearDamageTraining.exports.permanentBonus],base:(r,card)=>r.query(volibearTraining.exports.permanentBonus,card)+r.query(volibearDamageTraining.exports.permanentBonus,card)});
  return{exports:{nextAttackBonus:volibearNextAttack.exports.pendingBonus,nextPlayDiscount:volibearNextPlayDiscount.exports.pending,pendingRepeats:volibearRepeat.exports.pending,pendingEngageDiscounts:volibearEngagePreparation.exports.pending,effects,domain,permanentBonus}};
}});
