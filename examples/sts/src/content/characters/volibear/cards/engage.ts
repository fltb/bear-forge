import {cardEffects} from '../../../../rules/card-effects.ts';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {attributes} from '../../../../rules/attributes.ts';
import {powers} from '../../../../rules/powers.ts';
import type {PowerDefinition} from '../../../../rules/powers.types.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import type {EnemyActionReceipt} from '../../../../rules/enemies.types.ts';
import {registerCardAbilities} from '../../../cards/shared/lifecycle.ts';
import {volibearEngage} from '../mechanics/engage.ts';
import {volibearEngagePreparation} from '../mechanics/engage-preparation.ts';
import {lightning} from '../mechanics/lightning.ts';
import {volibearEngagePowers} from '../powers/engage.ts';
import {volibearCardDescriptions as cards} from './metadata.ts';
import {volibearCardPrograms,card,block,compose,queued} from './programs.ts';

export const volibearEngageCards=rules.defineRules({requires:[volibearCardPrograms,volibearEngage,volibearEngagePreparation,volibearEngagePowers,lightning,attributes],build(){
  const deploy=(definition:PowerDefinition,amount:readonly [number,number])=>queued(rules.defineEffect<CardUse,void>(b=>rules.call(powers.exports.apply,{
    registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),
    actor:b.read(v=>v.input.owner),source:b.read(v=>v.input.owner),debuff:false,definition,amount:b.read(v=>amount[v.input.state.upgraded?1:0]),
  })));
  const declaration={created:registerCardAbilities(volibearEngagePreparation.exports.declaresEngage)};
  const face=rules.defineEffect<CardUse,void>(b=>rules.forEach(rules.query(volibearCardPrograms.exports.singleTargets,b.input),target=>rules.call(volibearEngage.exports.execute,{use:b.input,target})));
  const retaliation=(thunder:boolean)=>rules.defineEffect<CardUse,void>(b=>{
    const result=b.local<EnemyActionReceipt>(),receipts=b.local<{target:number;absorbed:number}[]>();
    return rules.sequence(
      b.assign(receipts,[]),
      // Expand the engage instruction first; later attack instructions read the
      // receipt belonging to their target. Self block and native AoE run once.
      rules.forEach(rules.query(volibearCardPrograms.exports.singleTargets,b.input),target=>rules.sequence(
        b.assign(result,rules.call(volibearEngage.exports.execute,{use:b.input,target})),
        b.assign(receipts,b.read(v=>[...v.get(receipts),{target:v.get(target),absorbed:v.get(result).absorbed}])),
      )),
      rules.when(b.read(v=>v.query(battles.exports.status,v.input.battle).outcome===0),thunder?
        rules.call(lightning.exports.strike,{battle:b.read(v=>v.input.battle),owner:b.read(v=>v.input.owner),exclude:null,base:b.read(v=>(v.input.state.upgraded?6:4)+v.get(receipts).reduce((sum,r)=>sum+r.absorbed,0))}):
        rules.forEach(receipts,receipt=>rules.when(b.read(v=>v.query(battles.exports.status,v.input.battle).outcome===0&&v.query(attributes.exports.damageable,v.get(receipt).target)),rules.call(cardEffects.exports.hit,{use:b.input,targeted:true,request:{
          battle:b.read(v=>v.input.battle),source:b.read(v=>v.input.owner),target:b.read(v=>v.get(receipt).target),attack:true,selfDamage:false,
          amount:b.read(v=>v.query(attributes.exports.attackAmount,{source:v.input.owner,target:v.get(receipt).target,card:v.input.card,base:(v.input.state.upgraded?9:6)+v.get(receipt).absorbed+v.query(volibearCardPrograms.exports.fixedBonus,v.input)})),
        }}))),
      ),
    );
  });
  const all=rules.defineEffect<CardUse,void>(b=>{const total=b.local<number>(),receipt=b.local<EnemyActionReceipt>();return rules.sequence(
    b.assign(total,0),rules.forEach(rules.query(battles.exports.targets,b.read(v=>v.input.battle)),target=>rules.sequence(
      b.assign(receipt,rules.call(volibearEngage.exports.execute,{use:b.input,target})),
      b.assign(total,b.read(v=>v.get(total)+v.get(receipt).absorbed)),
    )),
    rules.when(b.read(v=>v.query(battles.exports.status,v.input.battle).outcome===0),rules.call(lightning.exports.strike,{battle:b.read(v=>v.input.battle),owner:b.read(v=>v.input.owner),exclude:null,base:total})),
  );});
  return {exports:{
    StandAndFight:card(cards.B04,compose(block([7,10]),queued(face)),declaration),
    ThunderForged:card(cards.U01,compose(block(10),deploy(volibearEngagePowers.exports.ThunderForged,[1,1]))),
    BattleScars:card(cards.U04,compose(block([8,11]),deploy(volibearEngagePowers.exports.BattleScars,[2,3]))),
    EndlessBattle:card(cards.R03,compose(block(12),deploy(volibearEngagePowers.exports.EndlessBattle,[1,1]))),
    EyeForEye:card(cards.C10,compose(block([12,16]),queued(retaliation(false))),declaration),
    ThunderCounter:card(cards.U28,compose(block([12,16]),queued(retaliation(true))),declaration),
    AllEnemiesCome:card(cards.R09,compose(block([20,28]),queued(all)),declaration),
  }};
}});
