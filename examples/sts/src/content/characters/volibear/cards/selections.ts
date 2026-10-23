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
export type VolibearSelectionScreens={discard:number;exhaust:number;discardToTop:number;scry:number;retain:number;copy:number;recover:number;train:number};
export function createVolibearSelectionCards(choices:rules.RuleModule<CardChoiceExports>,screens:VolibearSelectionScreens){
  return rules.defineRules({requires:[stormCharge,volibearStormPowers,powers,volibearCardPrograms,cardInstances,cardPiles,zones,choices,volibearRetention,volibearCopying,volibearNextPlayDiscount,volibearTraining,volibearNextAttack],build(){
    const cleanseLimit=2,huntBonus=[3,5] as const,rememberMaximum=2,recoveryCharge=3,scryCount=[2,3] as const;
    const hand=rules.defineQuery({input:cardUseSchema,output:z.array(z.number()),dependencies:[battles.exports.status,cardPiles.exports.bindings,zones.exports.members],base:(r,use)=>
      r.query(zones.exports.members,r.query(cardPiles.exports.bindings,r.query(battles.exports.status,use.battle).piles).hand).filter(id=>id!==use.card)});
    const canExchange=rules.defineQuery({input:cardUseSchema,output:z.boolean(),dependencies:[hand],base:(r,use)=>r.query(hand,use).length>0});
    const bad=rules.defineQuery({input:z.number(),output:z.boolean(),dependencies:[cardInstances.exports.metadata],base:(r,id)=>{const type=r.query(cardInstances.exports.metadata,id).type;return type===3||type===4;}});
    const cleanse=rules.defineEffect<CardUse,void>(b=>{const candidates=b.local<readonly number[]>(),selected=b.local<readonly number[]>();return rules.sequence(
      b.assign(candidates,b.read(v=>v.query(hand,v.input).filter(id=>v.query(bad,id)))),
      rules.when(b.read(v=>v.get(candidates).length===0),b.return(undefined)),
      b.assign(selected,rules.call(choices.exports.many,{battle:b.read(v=>v.input.battle),screen:screens.exhaust,cards:candidates,minimum:0,maximum:b.read(v=>v.input.state.upgraded?v.get(candidates).length:Math.min(cleanseLimit,v.get(candidates).length))})),
      rules.forEach(selected,card=>rules.when(b.read(v=>v.query(battles.exports.status,v.input.battle).outcome===0),rules.call(cardPiles.exports.exhaustWithoutOwnEffects,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),card}))),
    );});
    const exchange=rules.defineEffect<CardUse,void>(b=>{const selected=b.local<number|null>();return rules.sequence(
      b.assign(selected,rules.call(choices.exports.one,{battle:b.read(v=>v.input.battle),screen:screens.exhaust,cards:rules.query(hand,b.input)})),
      rules.when(b.read(v=>v.get(selected)===null),b.return(undefined)),
      rules.when(rules.query(bad,b.read(v=>v.get(selected)!)),
        rules.call(cardPiles.exports.exhaustWithoutOwnEffects,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),card:b.read(v=>v.get(selected)!)}),
        ruleModules.runTaskGroup(actionQueue,cardPiles.exports.exhaust,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),card:b.read(v=>v.get(selected)!)})),
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
    const train=(amplify:boolean)=>{const growth=amplify?[6,10] as const:[3,5] as const;return describeAmounts(rules.defineEffect<CardUse,void>(b=>{
      const list=b.local<readonly number[]>(),valid=b.local<number[]>(),selected=b.local<number|null>();
      return rules.sequence(
        b.assign(list,b.read(v=>{
          const p=v.get(rules.query(cardPiles.exports.current,v.get(rules.query(battles.exports.current,v.input.battle)).piles));
          return v.get(rules.query(zones.exports.members,p.hand));
        })),
        b.assign(valid,b.read(v=>v.get(list).filter(id=>v.get(rules.query(volibearTraining.exports.eligible,id))))),
        b.assign(selected,rules.call(choices.exports.one,{
          battle:b.read(v=>v.input.battle),screen:screens.train,cards:valid,
          indices:b.read(v=>v.get(valid).map(id=>v.get(list).indexOf(id))),
        })),
        rules.when(b.read(v=>v.get(selected)!==null),rules.call(volibearTraining.exports.add,{
          battle:b.read(v=>v.input.battle),card:b.read(v=>v.get(selected)!),
          amount:b.read(v=>(amplify?v.get(rules.query(volibearTraining.exports.permanentBonus,v.get(selected)!)):0)+cardAmount(growth,v)),
        })),
      );
    }),[growth],n=>`选择手牌固定伤害攻击，${amplify?'先将其本战永久固定攻击增量翻倍，再':''}${volibearTraining.exports.describe(n)}`);};
    const recover=(multiple:boolean)=>{const limit=multiple?[3,4] as const:1;return describeAmounts(rules.defineEffect<CardUse,void>(b=>{
      const piles=b.local<number>(),list=b.local<readonly number[]>(),valid=b.local<number[]>(),selected=b.local<readonly number[]>(),one=b.local<number|null>(),space=b.local<number>();
      return rules.sequence(
        b.assign(piles,b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).piles)),
        b.assign(space,b.read(v=>10-v.get(rules.query(zones.exports.members,v.get(rules.query(cardPiles.exports.current,v.get(piles))).hand)).length)),
        rules.when(b.read(v=>v.get(space)<=0),b.return(undefined)),
        b.assign(list,b.read(v=>v.get(rules.query(zones.exports.members,v.get(rules.query(cardPiles.exports.current,v.get(piles))).discard)))),
        b.assign(valid,b.read(v=>v.get(list).filter(id=>v.get(rules.query(cardInstances.exports.metadata,id)).type===CardType.Attack))),
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
          rules.call(volibearNextPlayDiscount.exports.grant,{battle:b.read(v=>v.input.battle),card}),
          rules.call(cardPiles.exports.moveToHand,{piles,card}),
        )),
      );
    }),[limit],n=>`从弃牌堆选择${multiple?'至多':''}${n}张攻击，按剩余手牌空间回收；每张获得：${volibearNextPlayDiscount.exports.text}`);};
    const copyAttack=rules.defineEffect<CardUse,void>(b=>{
      const list=b.local<readonly number[]>(),valid=b.local<number[]>(),selected=b.local<number|null>();
      return rules.sequence(
        b.assign(list,b.read(v=>{
          const p=v.get(rules.query(cardPiles.exports.current,v.get(rules.query(battles.exports.current,v.input.battle)).piles));
          return v.get(rules.query(zones.exports.members,p.hand));
        })),
        b.assign(valid,b.read(v=>v.get(list).filter(id=>v.get(rules.query(cardInstances.exports.metadata,id)).type===CardType.Attack))),
        b.assign(selected,rules.call(choices.exports.one,{
          battle:b.read(v=>v.input.battle),screen:screens.copy,cards:valid,
          indices:b.read(v=>v.get(valid).map(id=>v.get(list).indexOf(id))),
        })),
        rules.when(b.read(v=>v.get(selected)!==null),rules.call(volibearCopying.exports.copyToHand,{battle:b.read(v=>v.input.battle),source:b.read(v=>v.get(selected)!)})),
      );
    });
    const remember=rules.defineEffect<CardUse,void>(b=>{
      const list=b.local<readonly number[]>(),valid=b.local<number[]>(),selected=b.local<readonly number[]>(),one=b.local<number|null>();
      return rules.sequence(
        b.assign(list,b.read(v=>{
          const p=v.get(rules.query(cardPiles.exports.current,v.get(rules.query(battles.exports.current,v.input.battle)).piles));
          return v.get(rules.query(zones.exports.members,p.hand));
        })),
        b.assign(valid,b.read(v=>v.get(list).filter(id=>v.get(rules.query(cardInstances.exports.metadata,id)).type===CardType.Attack))),
        rules.when(b.read(v=>v.get(valid).length===0),b.return(undefined)),
        rules.when(b.read(v=>v.input.state.upgraded),
          b.assign(selected,rules.call(choices.exports.many,{
            battle:b.read(v=>v.input.battle),screen:screens.retain,cards:valid,minimum:0,maximum:rememberMaximum,
            indices:b.read(v=>v.get(valid).map(id=>v.get(list).indexOf(id))),
          })),
          rules.sequence(
            b.assign(one,rules.call(choices.exports.one,{
              battle:b.read(v=>v.input.battle),screen:screens.retain,cards:valid,
              indices:b.read(v=>v.get(valid).map(id=>v.get(list).indexOf(id))),
            })),
            b.assign(selected,b.read(v=>v.get(one)===null?[]:[v.get(one)!])),
          ),
        ),
        rules.forEach(selected,card=>rules.call(volibearRetention.exports.remember,{battle:b.read(v=>v.input.battle),owner:b.read(v=>v.input.owner),card})),
      );
    });
    const breathe=rules.defineEffect<CardUse,void>(b=>{const chosen=b.local<number|null>();return rules.sequence(
      b.assign(chosen,rules.call(choices.exports.one,{battle:b.read(v=>v.input.battle),screen:screens.exhaust,cards:rules.query(hand,b.input)})),
      rules.when(b.read(v=>v.get(chosen)!==null),rules.call(cardPiles.exports.exhaust,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),card:b.read(v=>v.get(chosen)!)})),
    );});
    const trainNext=deployPower(volibearStormPowers.exports.programs.NextTraining,[3,5]);
    const recoverExhausted=rules.defineEffect<CardUse,void>(b=>{const selected=b.local<readonly number[]>(),piles=b.local<number>(),candidates=b.local<number[]>();return rules.sequence(
      rules.when(b.read(v=>v.query(stormCharge.exports.current,v.input.battle).amount<recoveryCharge),b.return(undefined)),
      b.assign(piles,b.read(v=>v.query(battles.exports.status,v.input.battle).piles)),
      b.assign(candidates,b.read(v=>v.query(zones.exports.members,v.query(cardPiles.exports.bindings,v.get(piles)).exhaust).filter(id=>v.query(cardInstances.exports.metadata,id).type===0))),
      rules.when(b.read(v=>v.get(candidates).length===0),b.return(undefined)),
      b.assign(selected,rules.call(choices.exports.many,{battle:b.read(v=>v.input.battle),screen:screens.recover,minimum:0,maximum:1,cards:candidates})),
      rules.when(b.read(v=>v.get(selected).length>0),rules.sequence(
        rules.call(stormCharge.exports.consume,{battle:b.read(v=>v.input.battle),owner:b.read(v=>v.input.owner),amount:recoveryCharge}),
        rules.forEach(selected,card=>rules.sequence(
          rules.call(zones.exports.move,{entity:card,from:b.read(v=>v.query(cardPiles.exports.bindings,v.get(piles)).exhaust),to:null,index:0}),
          rules.call(cardPiles.exports.register,{piles,card}),
          rules.call(cardPiles.exports.moveToHand,{piles,card}),
        )),
      )),
    );});
    const prepareAttack=rules.defineEffect<CardUse,void>(b=>{
      const piles=b.local<number>(),selected=b.local<number|null>(),list=b.local<readonly number[]>(),valid=b.local<number[]>(),moved=b.local<boolean>();
      return rules.sequence(
        b.assign(piles,b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).piles)),
        b.assign(list,b.read(v=>v.get(rules.query(zones.exports.members,v.get(rules.query(cardPiles.exports.current,v.get(piles))).discard)))),
        b.assign(valid,b.read(v=>v.get(list).filter(id=>v.get(rules.query(cardInstances.exports.metadata,id)).type===CardType.Attack))),
        b.assign(selected,rules.call(choices.exports.one,{
          battle:b.read(v=>v.input.battle),screen:screens.discardToTop,cards:valid,
          indices:b.read(v=>v.get(valid).map(id=>v.get(list).indexOf(id))),
        })),
        rules.when(b.read(v=>v.get(selected)===null),b.return(undefined)),
        b.assign(moved,rules.call(zones.exports.move,b.read(v=>{
          const p=v.get(rules.query(cardPiles.exports.current,v.get(piles)));
          return {entity:v.get(selected)!,from:p.discard,to:p.draw,index:v.get(rules.query(zones.exports.members,p.draw)).length};
        }))),
        b.return(b.read(v=>{if(!v.get(moved))throw Error('Selected attack could not move to draw pile');return undefined;})),
      );
    });
    const scry=rules.defineEffect<CardUse,void>(b=>{
      const piles=b.local<number>(),looked=b.local<readonly number[]>(),selected=b.local<readonly number[]>(),moved=b.local<boolean>();
      return rules.sequence(
        b.assign(piles,b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).piles)),
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
    describeProgram(canExchange,'手牌中必须有另一张牌才能打出。');
    describeProgram(cleanse,`从其他手牌状态／诅咒中选择至多${cleanseLimit}张（升级后不限数量），禁止其自身效果并消耗。`);
    describeProgram(exchange,'消耗另一张手牌；若为状态／诅咒，先禁止其自身效果。');
    describeAmounts(prepareHunt,[huntBonus],n=>`选择手牌攻击：${volibearNextAttack.exports.describe(n)}`);
    describeProgram(copyAttack,'选择一张手牌攻击。'+volibearCopying.exports.text);
    describeProgram(remember,`选择手牌一张攻击（升级后可选至多${rememberMaximum}张）：${volibearRetention.exports.text}`);
    describeProgram(breathe,'消耗另一张手牌。');
    describeProgram(recoverExhausted,`若蓄雷至少${recoveryCharge}，可以选择消耗堆一张攻击，消耗${recoveryCharge}蓄雷并将其加入手牌；放弃不消耗蓄雷。`);
    describeProgram(prepareAttack,'选择弃牌堆一张攻击置于抽牌堆顶。');
    describeAmounts(scry,[scryCount],n=>`查看抽牌堆顶部${n}张牌，可任意弃置其中的牌，其余保持相对顺序；不视为从手牌弃牌。`);
    return {exports:{
      ThunderHunt:card(cards.R22,compose(attack([18,24]),queued(recoverExhausted))),
      TearBonds:card(cards.C16,compose(queued(cleanse),draw(1))),
      StormBreathing:card(cards.U15,compose(queued(exchange),draw([2,3])),{canUse:canExchange}),
      Breathing:card(cards.C13,compose(draw([3,4]),queued(breathe))),
      RegroupClaws:card(cards.C15,queued(recover(false))),
      HuntPreparation:card(cards.C19,queued(prepareHunt)),
      BattlePreparation:card(cards.U09,compose(block([10,13]),queued(prepareAttack),queued(gainCharge(2)))),
      HoneClaws:card(cards.U10,compose(draw([1,2]),queued(trainNext))),
      AncientInstinct:card(cards.U17,compose(queued(scry),draw(1))),
      LeaveBattleBehind:card(cards.U22,queued(copyAttack)),
      RememberPrey:card(cards.U30,compose(block([8,11]),queued(remember))),
      BattleNotOver:card(cards.R10,queued(recover(true))),
      AncientCraft:card(cards.R11,queued(train(true))),
    }};
  }});
}
