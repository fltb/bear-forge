import {gainCharge,deployPower} from './operations.ts';
import {describeProgram} from '../../../cards/shared/program-facts.ts';
import {cardAmount,describeAmounts} from '../../../cards/shared/programs.ts';
import {stormCharge} from '../mechanics/storm-charge.ts';
import {volibearStormPowers} from '../powers/storm.ts';
import {powers} from '../../../../rules/powers.ts';
import {rules} from '../../../../rules/execution.ts';
import {ruleModules} from '@bear-forge/card-engine';
import {z} from 'zod';
import {battles} from '../../../../rules/battles.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import {cardPiles} from '../../../../rules/card-piles.ts';
import {zones} from '../../../../rules/zones.ts';
import type {CardChoiceExports} from '../../../../rules/card-choices.types.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {registerCardAbilities} from '../../../cards/shared/lifecycle.ts';
import {cardUseSchema} from '../../../../rules/card-instances.schemas.ts';
import {actionQueue} from '../../../../rules/combat-actions.ts';
import {volibearCardDescriptions as cards,CardType} from './metadata.ts';
import {volibearCardPrograms,card,attack,block,draw,compose,queued} from './programs.ts';
import {volibearRetention} from '../mechanics/retention.ts';
import {volibearCopying} from '../mechanics/copying.ts';
import {volibearNextPlayDiscount} from '../mechanics/next-play-discount.ts';
import {volibearTraining} from '../mechanics/training.ts';
import {volibearNextAttack} from '../mechanics/next-attack.ts';

/** Presentation is supplied by the normal host adapter, independently of effects. */
export type VolibearSelectionScreens={discard:number;exhaust:number;discardToTop:number;scry:number;retain:number;copy:number;recover:number;train:number;beast:number;search:number};
export function createVolibearSelectionCards(choices:rules.RuleModule<CardChoiceExports>,screens:VolibearSelectionScreens){
  return rules.defineRules({requires:[stormCharge,volibearStormPowers,powers,volibearCardPrograms,cardInstances,cardPiles,zones,choices,volibearRetention,volibearCopying,volibearNextPlayDiscount,volibearTraining,volibearNextAttack],build(){
    const cleanseLimit=2,huntBonus=[3,5] as const,rememberMaximum=2,recoveryCharge=3,scryCount=[3,5] as const;
    const hand=rules.defineQuery({input:cardUseSchema,output:z.array(z.number()),dependencies:[battles.exports.status,cardPiles.exports.bindings,zones.exports.members],base:(r,use)=>
      r.query(zones.exports.members,r.query(cardPiles.exports.bindings,r.query(battles.exports.status,use.battle).piles).hand).filter(id=>id!==use.card)});
    const bad=rules.defineQuery({input:z.number(),output:z.boolean(),dependencies:[cardInstances.exports.metadata],base:(r,id)=>{const type=r.query(cardInstances.exports.metadata,id).type;return type===3||type===4;}});
    const exchange=rules.defineEffect<CardUse,void>(b=>{const selected=b.local<number|null>();return rules.sequence(
      b.assign(selected,rules.call(choices.exports.one,{battle:b.read(v=>v.input.battle),screen:screens.exhaust,cards:rules.query(hand,b.input)})),
      rules.when(b.read(v=>v.get(selected)===null),b.return(undefined)),
      ruleModules.runTaskGroup(actionQueue,cardPiles.exports.exhaust,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),card:b.read(v=>v.get(selected)!)}),
    );});
    const prepareHunt=rules.defineEffect<CardUse,void>(b=>{
      const list=b.local<readonly number[]>(),valid=b.local<number[]>(),selected=b.local<number|null>();
      return rules.sequence(
        b.assign(list,b.read(v=>{
          const p=v.get(rules.query(cardPiles.exports.current,v.get(rules.query(battles.exports.current,v.input.battle)).piles));
          return v.get(rules.query(zones.exports.members,p.hand));
        })),
        b.assign(valid,b.read(v=>v.get(list).filter(id=>v.get(rules.query(cardInstances.exports.metadata,id)).type===CardType.Attack))),
        b.assign(selected,rules.call(choices.exports.one,{
          battle:b.read(v=>v.input.battle),screen:screens.retain,cards:valid,
          indices:b.read(v=>v.get(valid).map(id=>v.get(list).indexOf(id))),
        })),
        rules.when(b.read(v=>v.get(selected)!==null),rules.call(volibearNextAttack.exports.prepare,{
          battle:b.read(v=>v.input.battle),card:b.read(v=>v.get(selected)!),amount:b.read(v=>cardAmount(huntBonus,v)),
        })),
      );
    });
    const recover=(multiple:boolean)=>{const limit=multiple?[3,4] as const:1;return describeAmounts(rules.defineEffect<CardUse,void>(b=>{
      const piles=b.local<number>(),list=b.local<readonly number[]>(),valid=b.local<number[]>(),selected=b.local<readonly number[]>(),one=b.local<number|null>(),space=b.local<number>();
      return rules.sequence(
        b.assign(piles,b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).piles)),
        b.assign(space,b.read(v=>10-v.get(rules.query(zones.exports.members,v.get(rules.query(cardPiles.exports.current,v.get(piles))).hand)).length)),
        rules.when(b.read(v=>v.get(space)<=0),b.return(undefined)),
        b.assign(list,b.read(v=>v.get(rules.query(zones.exports.members,v.get(rules.query(cardPiles.exports.current,v.get(piles))).discard)))),
        b.assign(valid,b.read(v=>v.get(list).filter(id=>(v.get(rules.query(cardInstances.exports.metadata,id)).type===CardType.Attack||!multiple&&v.query(volibearCardPrograms.exports.thunderSpell,v.query(cardInstances.exports.behaviorEntity,id)))))),
        rules.when(b.read(v=>v.get(valid).length===0),b.return(undefined)),
        rules.when(multiple,
          b.assign(selected,rules.call(choices.exports.many,{
            battle:b.read(v=>v.input.battle),screen:screens.recover,cards:valid,minimum:0,
            maximum:b.read(v=>Math.min(v.get(space),cardAmount(limit,v))),
            indices:b.read(v=>v.get(valid).map(id=>v.get(list).indexOf(id))),
          })),
          rules.sequence(
            b.assign(one,rules.call(choices.exports.one,{
              battle:b.read(v=>v.input.battle),screen:screens.recover,cards:valid,
              indices:b.read(v=>v.get(valid).map(id=>v.get(list).indexOf(id))),
            })),
            b.assign(selected,b.read(v=>v.get(one)===null?[]:[v.get(one)!])),
          ),
        ),
        rules.forEach(b.read(v=>v.get(list).filter(id=>v.get(selected).includes(id))),card=>rules.sequence(
          rules.call(cardPiles.exports.moveToHand,{piles,card}),
          rules.call(volibearNextPlayDiscount.exports.grant,{battle:b.read(v=>v.input.battle),card}),
        )),
      );
    }),[limit],n=>`从弃牌堆选择${multiple?'至多':''}${n}张${multiple?'攻击':'攻击或雷法'}，按剩余手牌空间回收；每张获得：${volibearNextPlayDiscount.exports.text}`);};
    const breathe=rules.defineEffect<CardUse,void>(b=>{const chosen=b.local<number|null>();return rules.sequence(
      b.assign(chosen,rules.call(choices.exports.one,{battle:b.read(v=>v.input.battle),screen:screens.exhaust,cards:rules.query(hand,b.input)})),
      rules.when(b.read(v=>v.get(chosen)!==null),rules.call(cardPiles.exports.exhaust,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),card:b.read(v=>v.get(chosen)!)})),
    );});
    const trainNext=deployPower(volibearStormPowers.exports.programs.NextTraining,[3,5]);
    const scry=rules.defineEffect<CardUse,void>(b=>{
      const piles=b.local<number>(),looked=b.local<readonly number[]>(),selected=b.local<readonly number[]>(),moved=b.local<boolean>();
      return rules.sequence(
        b.assign(piles,b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).piles)),
        rules.call(cardPiles.exports.revealDraw,{piles,count:b.read(v=>cardAmount(scryCount,v))}),
        b.assign(looked,b.read(v=>{
          const p=v.get(rules.query(cardPiles.exports.current,v.get(piles)));
          return [...v.get(rules.query(zones.exports.members,p.draw))].reverse().slice(0,cardAmount(scryCount,v));
        })),
        rules.when(b.read(v=>v.get(looked).length===0),b.return(undefined)),
        b.assign(selected,rules.call(choices.exports.many,{
          battle:b.read(v=>v.input.battle),screen:screens.scry,cards:looked,minimum:0,maximum:b.read(v=>v.get(looked).length),
        })),
        // Scry moves cards from the draw pile; it is not a hand-discard event.
        // Iterate the original top-first order, independent of selection order.
        rules.forEach(b.read(v=>v.get(looked).filter(id=>v.get(selected).includes(id))),entity=>rules.sequence(
          b.assign(moved,rules.call(zones.exports.move,b.read(v=>{
            const p=v.get(rules.query(cardPiles.exports.current,v.get(piles)));
            return {entity:v.get(entity),from:p.draw,to:p.discard,index:v.get(rules.query(zones.exports.members,p.discard)).length};
          }))),
          rules.when(b.read(v=>!v.get(moved)),b.return(b.read(()=>{throw Error('Scry card movement was canceled');}))),
        )),
      );
    });
    describeProgram(exchange,'消耗另一张手牌；没有其他手牌时跳过消耗。');
    describeAmounts(prepareHunt,[huntBonus],n=>`选择手牌攻击：${volibearNextAttack.exports.describe(n)}`);
    describeProgram(breathe,'消耗另一张手牌；没有其他手牌时跳过消耗。');
    describeAmounts(scry,[scryCount],n=>`查看抽牌堆顶部${n}张牌，可任意弃置其中的牌，其余保持相对顺序；不视为从手牌弃牌。`);
    return {exports:{
      StormBreathing:card(cards.U15,compose(queued(exchange),draw([2,3]))),
      Breathing:card(cards.C13,compose(queued(breathe),draw([3,4]))),
      RegroupClaws:card(cards.C15,queued(recover(false))),
      HuntPreparation:card(cards.C19,queued(prepareHunt)),
      HoneClaws:card(cards.U10,compose(draw([1,2]),queued(trainNext))),
      AncientInstinct:card(cards.U17,compose(queued(scry),draw(1))),
      BattleNotOver:card(cards.R10,queued(recover(true))),
    }};
  }});
}
