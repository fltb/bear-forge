import {rules} from '@bear-forge/card-engine';
import {resources} from '../../../../rules/resources.ts';
import {battles} from '../../../../rules/battles.ts';
import {cardPiles} from '../../../../rules/card-piles.ts';
import {zones} from '../../../../rules/zones.ts';
import {powers} from '../../../../rules/powers.ts';
import {basicPowers} from '../../../powers/attributes.ts';
import {volibearTraining} from '../mechanics/training.ts';
import {volibearInscription} from '../powers/inscription.ts';
import {volibearHunt} from '../powers/hunt.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {volibearCardDescriptions as cards} from './metadata.ts';
import {volibearCardPrograms,card,attack,block,thunder,compose,queued,draw} from './programs.ts';

export const volibearRareCards=rules.defineRules({requires:[volibearCardPrograms,volibearTraining,basicPowers,volibearInscription,volibearHunt],build(){
  const hunt=rules.defineEffect<CardUse,void>(b=>rules.call(powers.exports.apply,{
    registry:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).registry),
    scope:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).scope),
    definition:volibearHunt.exports.EndlessHunt,actor:b.read(v=>v.input.owner),source:b.read(v=>v.input.owner),debuff:false,amount:1,
  }));
  const inscribe=rules.defineEffect<CardUse,void>(b=>rules.call(powers.exports.apply,{
    registry:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).registry),
    scope:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).scope),
    definition:volibearInscription.exports.ThunderInscription,actor:b.read(v=>v.input.owner),source:b.read(v=>v.input.owner),debuff:false,amount:6,
  }));
  const unifyStrength=rules.defineEffect<CardUse,void>(b=>rules.call(powers.exports.apply,{
    registry:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).registry),
    scope:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).scope),
    definition:basicPowers.exports.Strength,actor:b.read(v=>v.input.owner),source:b.read(v=>v.input.owner),debuff:false,
    amount:b.read(v=>v.input.state.upgraded?4:3),
  }));
  const trainHand=rules.defineEffect<CardUse,void>(b=>rules.forEach(b.read(v=>{
    const piles=v.get(rules.query(cardPiles.exports.current,v.get(rules.query(battles.exports.current,v.input.battle)).piles));
    return v.get(rules.query(zones.exports.members,piles.hand)).filter(id=>v.get(rules.query(volibearTraining.exports.eligible,id)));
  }),card=>rules.call(volibearTraining.exports.add,{battle:b.read(v=>v.input.battle),card,amount:b.read(v=>v.input.state.upgraded?4:3)})));
  const tripleBlock=rules.defineEffect<CardUse,void>(b=>rules.call(resources.exports.gainBlock,{
    entity:b.read(v=>v.input.owner),amount:b.read(v=>2*v.get(rules.query(resources.exports.current,v.input.owner)).block),
  }));
  return {exports:{
    ThunderInscription:card(cards.R04,queued(inscribe)),
    EndlessHunt:card(cards.R14,queued(hunt)),
    WholeBodyStrength:card(cards.R05,queued(tripleBlock)),
    HeavenAndMan:card(cards.R06,compose(queued(unifyStrength),block([10,14]),queued(trainHand))),
    HeavenAndEarth:card(cards.R07,thunder(v=>v.get(rules.query(resources.exports.current,v.input.owner)).block)),
    ThunderousMight:card(cards.R08,compose(attack([10,13],4),thunder([5,8]))),
    UnleashInstinct:card(cards.R12,draw(v=>{
      const battle=v.get(rules.query(battles.exports.current,v.input.battle)),piles=v.get(rules.query(cardPiles.exports.current,battle.piles));
      return (v.input.state.upgraded?9:7)-v.get(rules.query(zones.exports.members,piles.hand)).length;
    })),
  }};
}});
