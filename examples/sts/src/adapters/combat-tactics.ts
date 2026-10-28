import {z} from 'zod';
import {rules} from '../rules/execution.ts';
import {battles} from '../rules/battles.ts';
import {queueCardSchema} from '../rules/battles.schemas.ts';
import {cardUseSchema} from '../rules/card-instances.schemas.ts';
import {cardInstances} from '../rules/card-instances.ts';
import type {CardConfig} from '../rules/card-instances.types.ts';
import {damageTermsFor,damageTermsSchema,programOpensDomain} from '../content/cards/shared/program-facts.ts';
import {volibearS2Powers} from '../content/characters/volibear/powers/s2.ts';
import {volibearDomain} from '../content/characters/volibear/mechanics/domain.ts';
import {lightning} from '../content/characters/volibear/mechanics/lightning.ts';

/** Source-owned operand projection, not a second effect runner. It intentionally
 * does not resolve checkpoints, draw cards, choose targets or predict deaths. */
export const combatTactics=rules.defineRules({requires:[battles,cardInstances,volibearS2Powers,volibearDomain,lightning],build(){
  const terms={kind:cardInstances.exports.kind,select:(c:rules.Borrowed<CardConfig>)=>damageTermsFor(c.use)};
  const yes=rules.defineQuery({input:cardUseSchema,output:z.boolean(),base:()=>true}),no=rules.defineQuery({input:cardUseSchema,output:z.boolean(),base:()=>false});
  const opens={kind:cardInstances.exports.kind,select:(c:rules.Borrowed<CardConfig>)=>programOpensDomain(c.use)?yes:no};
  const card=rules.defineQuery({input:queueCardSchema,output:damageTermsSchema,selections:[terms,opens],dependencies:[battles.exports.previewUse,battles.exports.effectRepetitions,cardInstances.exports.behaviorEntity,cardInstances.exports.metadata,volibearS2Powers.exports.effects,volibearDomain.exports.active,lightning.exports.amount],base:(r,input)=>{
    const use=r.query(battles.exports.previewUse,input),entity=r.query(cardInstances.exports.behaviorEntity,use.card);
    const repeat=1+r.query(battles.exports.effectRepetitions,use);
    const result=r.selected(terms,entity,use).map(term=>({...term,hits:term.hits*repeat}));
    if(r.query(cardInstances.exports.metadata,use.card).type===0){
      const electric=(base:number)=>r.query(lightning.exports.amount,{battle:use.battle,owner:use.owner,base,exclude:null});
      if(result.some(t=>t.label==='普通攻击'&&t.hits>0)&&(r.query(volibearDomain.exports.active,use.battle)||r.selected(opens,entity,use)))result.push({label:'领域附雷（全体，每次出牌1次）',target:null,amount:electric(volibearDomain.exports.attachmentDamage),hits:1});
      const segments=Math.max(0,...[...new Set(result.filter(t=>t.label==='普通攻击').map(t=>t.target))].map(target=>result.filter(t=>t.label==='普通攻击'&&t.target===target).reduce((n,t)=>n+t.hits,0)));
      if(segments>0)for(const power of r.query(volibearS2Powers.exports.effects,use.battle))if(power.owner===use.owner&&power.name==='狂雷渐起')result.push({label:'狂雷渐起（全体，每段1次）',target:null,amount:electric(power.level),hits:segments});
    }
    return result;
  }});
  return{exports:{card}};
}});
