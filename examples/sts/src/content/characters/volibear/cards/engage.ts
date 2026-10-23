import {deployPower,faceTarget} from './operations.ts';
import {describeProgram} from '../../../cards/shared/program-facts.ts';
import {describeAmounts} from '../../../cards/shared/programs.ts';
import {attackProgram} from '../../../cards/shared/program-facts.ts';
import {cardAmount} from '../../../cards/shared/programs.ts';
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
  const declaration={created:describeProgram(registerCardAbilities(volibearEngagePreparation.exports.declaresEngage),'')};
  const face=faceTarget();
  const retaliation=(thunder:boolean)=>{
    const base:readonly [number,number]=thunder?[4,6]:[8,12];
    const effect=rules.defineEffect<CardUse,void>(b=>{
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
        rules.call(lightning.exports.strike,{battle:b.read(v=>v.input.battle),owner:b.read(v=>v.input.owner),exclude:null,base:b.read(v=>cardAmount(base,v)+v.get(receipts).reduce((sum,r)=>sum+r.absorbed,0))}):
        rules.forEach(receipts,receipt=>rules.when(b.read(v=>v.query(battles.exports.status,v.input.battle).outcome===0&&v.query(attributes.exports.damageable,v.get(receipt).target)),rules.call(cardEffects.exports.hit,{use:b.input,targeted:true,request:{
          battle:b.read(v=>v.input.battle),source:b.read(v=>v.input.owner),target:b.read(v=>v.get(receipt).target),attack:true,selfDamage:false,
          amount:b.read(v=>v.query(attributes.exports.attackAmount,{source:v.input.owner,target:v.get(receipt).target,card:v.input.card,base:cardAmount(base,v)+v.get(receipt).absorbed+v.query(volibearCardPrograms.exports.fixedBonus,v.input)})),
        }}))),
      ),
    );
    });
    return describeAmounts(thunder?effect:attackProgram(effect,base,true),[base],n=>`先迎战目标。随后${thunder?`对全体造成${n}+本次迎战吸收总量的雷伤，合为一批`:`对各目标造成${n}+该目标迎战吸收量的攻击伤害`}。未实际迎战时吸收量为0。`);
  };
  const all=rules.defineEffect<CardUse,void>(b=>{const total=b.local<number>(),receipt=b.local<EnemyActionReceipt>();return rules.sequence(
    b.assign(total,0),rules.forEach(rules.query(battles.exports.targets,b.read(v=>v.input.battle)),target=>rules.sequence(
      b.assign(receipt,rules.call(volibearEngage.exports.execute,{use:b.input,target})),
      b.assign(total,b.read(v=>v.get(total)+v.get(receipt).absorbed)),
    )),
    rules.when(b.read(v=>v.query(battles.exports.status,v.input.battle).outcome===0),rules.call(lightning.exports.strike,{battle:b.read(v=>v.input.battle),owner:b.read(v=>v.input.owner),exclude:null,base:total})),
  );});
  describeProgram(all,'依次完整迎战全体敌人，再对全体造成本次迎战吸收总量的雷伤。'+volibearEngage.exports.text);
  return {exports:{
    StandAndFight:card(cards.B04,compose(block([7,10]),queued(face)),declaration),
    ThunderForged:card(cards.U01,compose(block([6,9]),queued(deployPower(volibearEngagePowers.exports.programs.ThunderForged,[1,1])))),
    BattleScars:card(cards.U04,compose(block([8,11]),queued(deployPower(volibearEngagePowers.exports.programs.BattleScars,[2,3])))),
    EndlessBattle:card(cards.R03,compose(block([10,14]),queued(deployPower(volibearEngagePowers.exports.programs.EndlessBattle,[1,1])))),
    EyeForEye:card(cards.C10,compose(block([15,20]),queued(retaliation(false))),declaration),
    ThunderCounter:card(cards.U28,compose(block([15,20]),queued(retaliation(true))),declaration),
    AllEnemiesCome:card(cards.R09,compose(block([20,28]),queued(all)),declaration),
  }};
}});
