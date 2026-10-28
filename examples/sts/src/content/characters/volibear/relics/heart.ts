import {describeProgram,programText} from '../../../cards/shared/program-facts.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {relics,type RelicDefinition} from '../../../../rules/relics.ts';
import {battles} from '../../../../rules/battles.ts';
import {cardPiles} from '../../../../rules/card-piles.ts';
import {volibearEngage,type EngageReceipt} from '../mechanics/engage.ts';
export const volibearHearts=rules.defineRules({requires:[battles,relics,cardPiles,volibearEngage],build(){
  const last=rules.defineComponent({schema:z.object({battle:z.int32(),turn:z.int32()}),initial:()=>({battle:-1,turn:-1})});
  const trigger=(amount:number)=>rules.on(volibearEngage.exports.completed,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<EngageReceipt>>(),output:z.boolean(),reads:[last],dependencies:[battles.exports.status],base:(r,c)=>{const s=r.component(c.source,last);return c.event.use.owner===c.owner&&(s.battle!==c.event.use.battle||s.turn!==r.query(battles.exports.status,c.event.use.battle).turn);}}),
    effect:rules.defineEffect<rules.ReactionContext<EngageReceipt>,void>(b=>rules.sequence(
      rules.updateLocalComponent(b.read(v=>v.input.source),last,b.read(v=>({battle:v.input.event.use.battle,turn:v.query(battles.exports.status,v.input.event.use.battle).turn}))),
      rules.call(cardPiles.exports.draw,{piles:b.read(v=>v.query(battles.exports.status,v.input.event.use.battle).piles),count:amount}),
    )),
  });
  const install=(amount:number)=>describeProgram(rules.defineEffect<rules.EntityLifecycle,void>(b=>rules.install({ability:trigger(amount),source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.owner!),environment:{},lifetime:b.read(v=>v.input.scope)})),`每回合首次完成迎战时，抽${amount}张牌。`);
  const hunter=install(1),immortal=install(2);
  const HuntersHeart=rules.defineEntity(relics.exports.kind,{id:'VOLIBEAR_HUNTERS_HEART',install:hunter},{components:[last]});
  const ImmortalHeart:RelicDefinition=rules.defineEntity(relics.exports.kind,{id:'VOLIBEAR_IMMORTAL_HEART',replaces:HuntersHeart,install:immortal},{components:[last]});
  return {exports:{HuntersHeart,ImmortalHeart,texts:{VOLIBEAR_HUNTERS_HEART:programText(hunter)!,VOLIBEAR_IMMORTAL_HEART:programText(immortal)!}}};
}});
