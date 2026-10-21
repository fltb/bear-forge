import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {turns} from '../../../../rules/turns.ts';
import {resources} from '../../../../rules/resources.ts';
import {cardPiles} from '../../../../rules/card-piles.ts';
import {actionQueue} from '../../../../rules/combat-actions.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import type {TurnActor} from '../../../../rules/turns.types.ts';

type Preparation={battle:number;actor:number;turn:number;draw:number};
export const volibearPreparation=rules.defineRules({requires:[turns,battles,resources,cardPiles],build(){
  const nextTurn=rules.defineQuery({
    input:z.custom<{event:TurnActor;input:Preparation;source:number|null}>(),output:z.boolean(),dependencies:[battles.exports.current],
    base:(r,c)=>c.event.battle===c.input.battle&&c.event.actor===c.input.actor&&r.query(battles.exports.current,c.input.battle).turn>c.input.turn,
  });
  const deliver=rules.defineEffect<Preparation,void>(b=>rules.sequence(
    rules.call(resources.exports.gainEnergy,{entity:b.read(v=>v.input.actor),amount:2}),
    rules.call(cardPiles.exports.draw,{piles:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).piles),count:b.read(v=>v.input.draw)}),
  ));
  const prepare=rules.defineEffect<CardUse,void>(b=>rules.schedule(deliver,{
    battle:b.read(v=>v.input.battle),actor:b.read(v=>v.input.owner),
    turn:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).turn),draw:b.read(v=>v.input.state.upgraded?3:2),
  },{
    at:{event:turns.exports.afterRecharge,condition:nextTurn},queue:actionQueue,
    source:b.read(v=>v.input.card),eligible:'captured',
    lifetime:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).scope),
  }));
  return {exports:{prepare}};
}});
