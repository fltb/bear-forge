import {rules} from '@bear-forge/card-engine';
import {attributes} from '../../../../rules/attributes.ts';
import {battles} from '../../../../rules/battles.ts';
import {powers} from '../../../../rules/powers.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import {cardPiles} from '../../../../rules/card-piles.ts';
import {zones} from '../../../../rules/zones.ts';
import {basicPowers} from '../../../powers/attributes.ts';
import {volibearCardDescriptions as cards} from './metadata.ts';
import {volibearCardPrograms,card,attack,block,thunder,compose,queued,draw} from './programs.ts';
import {volibearOpportunities} from '../mechanics/opportunities.ts';
import {volibearStrength} from '../mechanics/strength.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';

export const volibearCommonCards=rules.defineRules({requires:[volibearCardPrograms,basicPowers,volibearOpportunities,volibearStrength],build(){
  const press=rules.defineEffect<CardUse,void>(b=>{
    const defending=b.local<boolean>();
    return rules.sequence(
      b.assign(defending,rules.query(volibearOpportunities.exports.awaitingAttack,b.input)),
      rules.call(attack([8,11]),b.input),
      rules.when(defending,rules.call(block([6,8]),b.input),rules.call(draw(1),b.input)),
    );
  });
  const pursue=rules.defineEffect<CardUse,void>(b=>{
    const acted=b.local<boolean>();
    return rules.sequence(b.assign(acted,rules.query(volibearOpportunities.exports.acted,b.input)),
      rules.call(attack([10,14]),b.input),rules.when(acted,rules.call(draw(1),b.input)));
  });
  const retrieve=queued(rules.defineEffect<CardUse,void>(b=>{
    const selected=b.local<number|null>(),piles=b.local<number>();
    return rules.sequence(
      b.assign(piles,b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).piles)),
      b.assign(selected,b.read(v=>{
        const p=v.get(rules.query(cardPiles.exports.current,v.get(piles)));
        return [...v.get(rules.query(zones.exports.members,p.draw))].reverse().find(id=>v.get(rules.query(cardInstances.exports.metadata,id)).type===0)??null;
      })),
      rules.when(b.read(v=>v.get(selected)!==null),rules.call(cardPiles.exports.moveToHand,{piles,card:b.read(v=>v.get(selected)!)})),
    );
  }));
  const vulnerable=rules.defineEffect<CardUse,void>(b=>rules.forEach(rules.query(volibearCardPrograms.exports.singleTargets,b.input),target=>
    rules.when(rules.query(attributes.exports.damageable,target),rules.call(powers.exports.apply,{
      definition:basicPowers.exports.EnemyVulnerable,
      registry:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).registry),
      scope:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).scope),
      actor:target,source:b.read(v=>v.input.owner),amount:b.read(v=>v.input.state.upgraded?2:1),debuff:true,
    })),
  ));
  const wave=compose(attack([5,7],1,true),thunder([2,3]));
  return {exports:{
    Approach:card(cards.C01,attack([5,8])),
    TwinClaws:card(cards.C02,attack([5,7],2)),
    ThunderSmash:card(cards.C03,compose(attack([16,21]),thunder([5,7]))),
    LightningClaw:card(cards.C05,compose(attack([7,10]),thunder([3,4]))),
    PressForward:card(cards.C06,press),
    FollowScent:card(cards.C07,compose(attack([8,11]),retrieve)),
    TearWound:card(cards.C08,compose(attack([8,10]),queued(vulnerable))),
    ThunderSweep:card(cards.C09,compose(attack([6,8],1,true),thunder([3,4]))),
    ThickFur:card(cards.C12,block(v=>(v.input.state.upgraded?11:8)+Math.max(0,v.get(rules.query(attributes.exports.strength,v.input.owner))))),
    ThunderGuard:card(cards.C14,compose(block([8,11]),thunder([3,4]))),
    Charge:card(cards.C17,queued(volibearStrength.exports.charge)),
    Pursuit:card(cards.C20,pursue),
    HoldGround:card(cards.C21,block(v=>(v.input.state.upgraded?11:8)+(v.get(rules.query(volibearOpportunities.exports.acted,v.input))?4:0))),
    ThunderShock:card(cards.C22,compose(wave,wave)),
  }};
}});
