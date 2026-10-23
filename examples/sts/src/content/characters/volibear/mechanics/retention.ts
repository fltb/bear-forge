import {describeProgram} from '../../../cards/shared/program-facts.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import type {CardVariant} from '../../../../rules/card-instances.types.ts';

/** Battle retention is a variant modifier, independent of the one-end flag
 * that the ordinary turn controller clears when returning retained cards.
 */
export const volibearRetention=rules.defineRules({requires:[battles,cardInstances],build(){
  const retained=rules.modify(cardInstances.exports.variant,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<number,CardVariant>>(),output:z.boolean(),base:(_r,c)=>c.input===c.source}),
    transform:(_r,c)=>({...c.value,retain:true}),
  });
  const remember=rules.defineEffect<{battle:number;owner:number;card:number},void>(b=>rules.install({
    ability:retained,source:b.read(v=>v.input.card),owner:b.read(v=>v.input.owner),environment:{},
    lifetime:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).scope),
  }));
  const text='所选牌本场战斗获得保留。';
  describeProgram(remember,text);
  return {exports:{remember,text}};
}});
