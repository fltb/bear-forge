import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {relics,type RelicDefinition} from '../../../../rules/relics.ts';
import {battles} from '../../../../rules/battles.ts';
import {resources} from '../../../../rules/resources.ts';
import {cardPiles} from '../../../../rules/card-piles.ts';
import {actionQueue} from '../../../../rules/combat-actions.ts';
import {lightning} from '../mechanics/lightning.ts';
import {volibearPlayCounts,type CountedAttack} from '../mechanics/play-counts.ts';

export const volibearHearts=rules.defineRules({requires:[relics,lightning,battles,volibearPlayCounts],build(){
  const secondAttack=rules.defineQuery({input:z.custom<rules.ReactionContext<CountedAttack>>(),output:z.boolean(),
    base:(_r,c)=>c.event.use.owner===c.owner&&c.event.ordinal===2,
  });
  function trigger(block:number,draw:boolean){
    return rules.on(volibearPlayCounts.exports.counted,{condition:secondAttack,
      effect:rules.defineEffect<rules.ReactionContext<CountedAttack>,void>(b=>{
        const options={queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.get(rules.query(battles.exports.current,v.input.event.use.battle)).actionScope),eligible:'captured' as const};
        return rules.sequence(
          // Relic block deliberately does not query Dexterity/Frail.
          rules.enqueue(resources.exports.gainBlock,{entity:b.read(v=>v.input.owner),amount:block},options),
          rules.enqueue(lightning.exports.strike,{battle:b.read(v=>v.input.event.use.battle),owner:b.read(v=>v.input.owner),base:3,exclude:null},options),
          rules.when(draw,rules.enqueue(cardPiles.exports.draw,{piles:b.read(v=>v.get(rules.query(battles.exports.current,v.input.event.use.battle)).piles),count:1},options)),
        );
      }),
    });
  }
  const hunter=trigger(4,false),immortal=trigger(8,true);
  const install=(ability:rules.Ability)=>rules.defineEffect<rules.EntityLifecycle,void>(b=>rules.sequence(...[volibearPlayCounts.exports.startCounting,ability].map(ability=>rules.install({
    ability,source:b.read(v=>v.input.entity),owner:b.read(v=>{if(v.input.owner===null)throw Error('A heart relic requires an actor');return v.input.owner;}),environment:{},lifetime:b.read(v=>v.input.scope),
  }))));
  const HuntersHeart=rules.defineEntity(relics.exports.kind,{id:'VOLIBEAR_HUNTERS_HEART',install:install(hunter)});
  const ImmortalHeart:RelicDefinition=rules.defineEntity(relics.exports.kind,{id:'VOLIBEAR_IMMORTAL_HEART',replaces:HuntersHeart,install:install(immortal)});
  return {exports:{HuntersHeart,ImmortalHeart}};
}});
