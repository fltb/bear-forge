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
import {powers} from '../../../rules/powers.ts';
import {battles} from '../../../rules/battles.ts';
/** Character-specific public data, composed into STS's existing observation. */
export const volibearPresentation=rules.defineRules({requires:[volibearNextAttack,volibearNextPlayDiscount,volibearRepeat,volibearEngagePreparation,volibearDomain,volibearTraining,powers,battles],build(){
  const effects=rules.defineQuery({input:z.object({battle:z.number(),enemies:z.array(z.number().nullable())}),output:z.array(z.object({actor:z.number(),target:z.string(),name:z.string(),text:z.string(),level:z.number(),active:z.boolean()})),dependencies:[battles.exports.status,powers.exports.entries,powers.exports.current,powers.exports.display,powers.exports.presentation],base:(r,input)=>{
    const board=r.query(battles.exports.status,input.battle);
    return r.query(powers.exports.entries,board.registry).flatMap(entry=>{
      const custom=r.query(powers.exports.display,entry.entity),state=r.query(powers.exports.current,entry.entity),p=r.query(powers.exports.presentation,entry.entity);
      const enemyIndex=input.enemies.indexOf(state.actor);
      if(state.phase!==1||state.actor!==board.actor&&enemyIndex<0)return[];
      const name=p?Object.entries(state.actor===board.actor?PS:MS).find(([,key])=>key===p.key)?.[0]:undefined;
      const display=custom??(name&&statusTexts[name]?{name,text:statusTexts[name]}:null);
      if(!display)return[];
      return[{...display,actor:state.actor,target:state.actor===board.actor?'player':'enemy:'+enemyIndex,level:state.level,active:state.active}];
    });
  }});
  const domain=rules.defineQuery({input:z.number(),output:z.object({active:z.boolean(),untilTurn:z.number().nullable()}),dependencies:[volibearDomain.exports.current,volibearDomain.exports.active],base:(r,battle)=>({active:r.query(volibearDomain.exports.active,battle),untilTurn:r.query(volibearDomain.exports.current,battle)?.until??null})});
  return{exports:{nextAttackBonus:volibearNextAttack.exports.pendingBonus,nextPlayDiscount:volibearNextPlayDiscount.exports.pending,pendingRepeats:volibearRepeat.exports.pending,pendingEngageDiscounts:volibearEngagePreparation.exports.pending,effects,domain,permanentBonus:volibearTraining.exports.permanentBonus}};
}});
