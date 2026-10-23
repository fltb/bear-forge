import {describeProgram,programText} from '../../../cards/shared/program-facts.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {relics,type RelicDefinition} from '../../../../rules/relics.ts';
import {battles} from '../../../../rules/battles.ts';
import {turns} from '../../../../rules/turns.ts';
import type {TurnActor} from '../../../../rules/turns.types.ts';
import {stormCharge} from '../mechanics/storm-charge.ts';

export const volibearHearts=rules.defineRules({requires:[battles,relics,turns,stormCharge],build(){
  const trigger=(amount:number)=>rules.on(turns.exports.playerStartRelics,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<TurnActor>>(),output:z.boolean(),base:(_r,c)=>c.event.actor===c.owner}),
    effect:rules.defineEffect<rules.ReactionContext<TurnActor>,void>(b=>rules.call(stormCharge.exports.gain,{battle:b.read(v=>v.input.event.battle),owner:b.read(v=>v.input.owner),amount})),
  });
  const initial=(amount:number)=>rules.on(battles.exports.started,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<number>>(),output:z.boolean(),dependencies:[battles.exports.status],base:(r,c)=>r.query(battles.exports.status,c.event).actor===c.owner}),
    effect:rules.defineEffect<rules.ReactionContext<number>,void>(b=>rules.call(stormCharge.exports.gain,{battle:b.read(v=>v.input.event),owner:b.read(v=>v.input.owner),amount})),
  });
  const install=(amount:number)=>describeProgram(rules.defineEffect<rules.EntityLifecycle,void>(b=>rules.sequence(...[initial(amount),trigger(amount)].map(ability=>rules.install({ability,source:b.read(v=>v.input.entity),owner:b.read(v=>{if(v.input.owner===null)throw Error('Storm relic requires an actor');return v.input.owner;}),environment:{},lifetime:b.read(v=>v.input.scope)})))),`战斗开始及之后每个玩家回合开始时，获得${amount}蓄雷。`);
  const hunter=install(1),immortal=install(2);
  const HuntersHeart=rules.defineEntity(relics.exports.kind,{id:'VOLIBEAR_HUNTERS_HEART',install:hunter});
  const ImmortalHeart:RelicDefinition=rules.defineEntity(relics.exports.kind,{id:'VOLIBEAR_IMMORTAL_HEART',replaces:HuntersHeart,install:immortal});
  return {exports:{HuntersHeart,ImmortalHeart,texts:{VOLIBEAR_HUNTERS_HEART:programText(hunter)!,VOLIBEAR_IMMORTAL_HEART:programText(immortal)!}}};
}});
