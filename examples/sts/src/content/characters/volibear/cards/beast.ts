import {volibearS2Powers} from '../powers/s2.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {ruleModules} from '@bear-forge/card-engine';
import {battles} from '../../../../rules/battles.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import {cardPiles} from '../../../../rules/card-piles.ts';
import {zones} from '../../../../rules/zones.ts';
import {resources} from '../../../../rules/resources.ts';
import {attributes} from '../../../../rules/attributes.ts';
import {turns} from '../../../../rules/turns.ts';
import {actionQueue} from '../../../../rules/combat-actions.ts';
import type {TurnActor} from '../../../../rules/turns.types.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import type {CardChoiceExports} from '../../../../rules/card-choices.types.ts';
import {cardUseSchema} from '../../../../rules/card-instances.schemas.ts';
import {volibearBeast,type BeastChange} from '../mechanics/beast.ts';
import {stormCharge} from '../mechanics/storm-charge.ts';
import {volibearNextPlayDiscount} from '../mechanics/next-play-discount.ts';
import {cardAmount,describeAmounts,type CardAmount} from '../../../cards/shared/programs.ts';
import {describeProgram} from '../../../cards/shared/program-facts.ts';
import {volibearCardDescriptions as cards} from './metadata.ts';
import {volibearCardPrograms,card,attack,block,thunder,compose,queued} from './programs.ts';
import {openDomain} from './operations.ts';

export function createVolibearBeastCards(choices:rules.RuleModule<CardChoiceExports>,screens:{beast:number;search:number}){
return rules.defineRules({requires:[volibearS2Powers,choices,volibearBeast,stormCharge,volibearNextPlayDiscount,volibearCardPrograms,turns],build(m){
  const hand=rules.defineQuery({input:cardUseSchema,output:z.array(z.int32()),dependencies:[battles.exports.status,cardPiles.exports.bindings,zones.exports.members],base:(r,use)=>r.query(zones.exports.members,r.query(cardPiles.exports.bindings,r.query(battles.exports.status,use.battle).piles).hand).filter(id=>id!==use.card)});
  function transform(max:CardAmount,mode:'attack'|'other'|'any'|'all'|'old',optional=false,discount=true){
    return describeAmounts(rules.defineEffect<CardUse,void>(b=>{const selected=b.local<readonly number[]>(),shape=b.local<number>();return rules.sequence(
      b.assign(selected,b.read(v=>v.query(hand,v.input).filter(id=>mode==='attack'?v.query(cardInstances.exports.metadata,id).type===0:mode==='other'?v.query(cardInstances.exports.metadata,id).type!==0:true))),
      ...(mode==='all'?[]:[b.assign(selected,rules.call(choices.exports.many,{battle:b.read(v=>v.input.battle),screen:screens.beast,cards:selected,minimum:b.read(v=>optional?0:Math.min(cardAmount(max,v),v.get(selected).length)),maximum:b.read(v=>Math.min(cardAmount(max,v),v.get(selected).length))}))]),
      // Frozen before conversion; event-drawn cards never enter this batch.
      rules.forEach(selected,card=>rules.sequence(
        b.assign(shape,ruleModules.runTaskGroup(actionQueue,volibearBeast.exports.convert,{battle:b.read(v=>v.input.battle),card})),
        ...(discount?[rules.when(b.read(v=>mode!=='old'||v.get(shape)===1),rules.call(volibearNextPlayDiscount.exports.grant,{battle:b.read(v=>v.input.battle),card}))]:[]),
        ...(mode==='old'?[rules.when(b.read(v=>v.get(shape)===2),rules.call(block(4),b.input))]:[]),
      )),
    );}),[max],n=>`${optional?'可选至多':''}兽化${mode==='all'?'全部':n+'张'}${mode==='attack'?'攻击':mode==='other'?'非攻击':''}手牌。${discount?'所得形态本回合减费1。':''}${mode==='old'?'仅爪形减费；每张躯形获得4格挡。':''}`);
  }
  function search(filter:'all'|'attack'|'spell'|'skill',maximum:number,optional=false){
    return describeProgram(rules.defineEffect<CardUse,void>(b=>{const piles=b.local<number>(),candidates=b.local<readonly number[]>(),selected=b.local<readonly number[]>(),space=b.local<number>();return rules.sequence(
      b.assign(piles,b.read(v=>v.query(battles.exports.status,v.input.battle).piles)),
      b.assign(space,b.read(v=>10-v.query(zones.exports.members,v.query(cardPiles.exports.bindings,v.get(piles)).hand).length)),
      rules.when(b.read(v=>v.get(space)<=0),b.return(undefined)),
      rules.call(cardPiles.exports.resolveDrawOrder,piles),
      b.assign(candidates,b.read(v=>v.query(zones.exports.members,v.query(cardPiles.exports.bindings,v.get(piles)).draw).filter(id=>filter==='all'||filter==='attack'&&v.query(cardInstances.exports.metadata,id).type===0||filter==='skill'&&v.query(cardInstances.exports.metadata,id).type===1||filter==='spell'&&v.query(volibearCardPrograms.exports.thunderSpell,v.query(cardInstances.exports.behaviorEntity,id))))),
      b.assign(selected,rules.call(choices.exports.many,{battle:b.read(v=>v.input.battle),screen:screens.search,cards:candidates,minimum:b.read(v=>optional?0:Math.min(maximum,v.get(space),v.get(candidates).length)),maximum:b.read(v=>Math.min(maximum,v.get(space),v.get(candidates).length))})),
      rules.forEach(selected,card=>rules.call(cardPiles.exports.moveToHand,{piles,card})),
    );}),`从抽牌堆选择${optional?'至多':''}${maximum}张${{all:'牌',attack:'攻击',spell:'雷法',skill:'技能'}[filter]}加入手牌，先占用手牌位置。`);
  }
  const instance=z.object({battle:z.int32(),owner:z.int32(),level:z.int32(),lastTransform:z.int32(),lastShape:z.int32(),lastClaw:z.int32(),use:cardUseSchema});
  const state=m.own(rules.defineComponent({schema:instance.nullable(),initial:()=>null}));
  const writeState=m.atom({input:z.object({entity:z.int32(),value:instance}),output:z.undefined(),reads:[],writes:[state],emits:[],run(_r,i){return{writes:[{entity:i.entity,component:state,value:i.value}],events:[],result:undefined};}});
  const get=rules.defineQuery({input:z.int32(),output:instance,reads:[state],base:(r,id)=>r.component(id,state)!});
  const mark=(key:'lastTransform'|'lastShape'|'lastClaw')=>rules.defineEffect<number,void>(b=>rules.call(writeState,{entity:b.input,value:b.read(v=>{const s=v.query(get,v.input);return{...s,[key]:v.query(battles.exports.status,s.battle).turn};})}));
  const convertOne=transform(1,'any',true,false);
  const infected=rules.on(volibearBeast.exports.changed,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<BeastChange>>(),output:z.boolean(),dependencies:[get,battles.exports.status],base:(r,c)=>{const s=r.query(get,c.source);return s.battle===c.event.battle&&s.lastTransform!==r.query(battles.exports.status,s.battle).turn;}}),
    effect:rules.defineEffect<rules.ReactionContext<BeastChange>,void>(b=>rules.sequence(rules.call(mark('lastTransform'),b.read(v=>v.input.source)),rules.call(cardPiles.exports.draw,{piles:b.read(v=>v.query(battles.exports.status,v.input.event.battle).piles),count:b.read(v=>v.query(get,v.input.source).level)}))),
  });
  const shaped=(wild:boolean)=>rules.on(battles.exports.using,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<CardUse>>(),output:z.boolean(),dependencies:[get,volibearBeast.exports.shape,battles.exports.status],base:(r,c)=>{const s=r.query(get,c.source),shape=r.query(volibearBeast.exports.shape,c.event.card),key=wild?'lastClaw':'lastShape';return s.battle===c.event.battle&&c.event.triggerOnUse&&!c.event.purgeOnUse&&shape!==0&&(wild&&shape===2||s[key]!==r.query(battles.exports.status,s.battle).turn);}}),
    effect:rules.defineEffect<rules.ReactionContext<CardUse>,void>(b=>rules.sequence(
      rules.when(b.read(v=>!wild),rules.call(mark('lastShape'),b.read(v=>v.input.source)),rules.when(b.read(v=>v.query(volibearBeast.exports.shape,v.input.event.card)===1),rules.call(mark('lastClaw'),b.read(v=>v.input.source)))),
      rules.enqueue(rules.defineEffect<{entity:number;shape:number},void>(b=>rules.when(!wild,rules.call(stormCharge.exports.gain,{battle:b.read(v=>v.query(get,v.input.entity).battle),owner:b.read(v=>v.query(get,v.input.entity).owner),amount:1}),rules.when(b.read(v=>v.input.shape===1),rules.call(resources.exports.gainBlock,{entity:b.read(v=>v.query(get,v.input.entity).owner),amount:b.read(v=>Math.max(0,v.query(attributes.exports.blockAmount,{actor:v.query(get,v.input.entity).owner,base:v.query(get,v.input.entity).level})))}),rules.call(resources.exports.gainEnergy,{entity:b.read(v=>v.query(get,v.input.entity).owner),amount:1})))),{entity:b.read(v=>v.input.source),shape:b.read(v=>v.query(volibearBeast.exports.shape,v.input.event.card))},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.battle).scope),eligible:'captured'}),
    )),
  });
  const turn=rules.on(turns.exports.playerPostDrawPowers,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<TurnActor>>(),output:z.boolean(),dependencies:[get],base:(r,c)=>r.query(get,c.source).battle===c.event.battle}),
    effect:rules.defineEffect<rules.ReactionContext<TurnActor>,void>(b=>rules.enqueue(convertOne,b.read(v=>v.query(get,v.input.source).use),{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.battle).scope),eligible:'captured'})),
  });
  const display=rules.modify(volibearS2Powers.exports.effects,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<number,unknown>>(),output:z.boolean(),dependencies:[get],base:(r,c)=>r.query(get,c.source).battle===c.input}),
    dependencies:[get],transform:(r,c)=>{const s=r.query(get,c.source),wild=s.level>=6;return[...c.value,{battle:s.battle,owner:s.owner,level:s.level,turn:-1,name:wild?'我即荒野':'熊灵侵染',text:wild?'每回合首次爪形获得格挡、每次实际打出躯形获得1能量。':'每回合首次兽化抽牌、首次打出兽形获得1雷势；起手抽牌和领域扣时后可选兽化。'}];},
  });
  function deploy(wild:boolean){const kind=m.kind({config:z.undefined(),setup:instance,components:[state],initialize:rules.defineEffect<rules.EntityLifecycle<z.infer<typeof instance>>,void>(b=>rules.sequence(rules.call(writeState,{entity:b.read(v=>v.input.entity),value:b.read(v=>v.input.setup)}),...[display,...(wild?[shaped(true)]:[infected,shaped(false),turn])].map(ability=>rules.install({ability,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.setup.owner),environment:{},lifetime:b.read(v=>v.input.scope)}))))});const definition=rules.defineEntity(kind,undefined);return describeProgram(rules.defineEffect<CardUse,void>(b=>rules.spawnEntity({definition,owner:b.read(v=>v.input.owner),scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),setup:b.read(v=>({battle:v.input.battle,owner:v.input.owner,level:wild?(v.input.state.upgraded?9:6):(v.input.state.upgraded?2:1),lastTransform:-1,lastShape:-1,lastClaw:-1,use:v.input}))})),wild?'每实例每回合首次爪形获得6（9）格挡，每次实际打出躯形获得1能量。':'每实例每回合首次兽化抽1（2）张；首次实际打出兽形在支付后、牌效前获得1雷势。正常起手抽牌及领域扣时后，可选兽化1张手牌。');}
  const removeBlock=describeProgram(rules.defineEffect<CardUse,void>(b=>rules.when(b.read(v=>v.input.target!==null),rules.call(resources.exports.consumeBlock,{entity:b.read(v=>v.input.target!),amount:b.read(v=>v.query(resources.exports.defense,v.input.target!).block)}))),'移除目标全部格挡。');
  return{exports:{
    FollowScent:card(cards.C07,compose(attack([8,11]),queued(search('attack',1)))),
    ThunderOmen:card(cards.U39,compose(block([4,7]),queued(openDomain(1)),queued(search('spell',1)))),
    BreakSkin:card(cards.U41,compose(attack([3,6]),queued(transform(1,'attack')))),
    WildArmor:card(cards.U42,compose(block([3,6]),queued(transform(1,'other')))),
    FollowInstinct:card(cards.U43,compose(queued(search('all',1)),queued(transform(1,'any')))),
    StormReborn:card(cards.R25,compose(queued(openDomain(2)),queued(search('skill',2,true)))),
    OldDays:card(cards.R27,queued(transform([2,3],'old',true))),
    BearSpirit:card(cards.R28,compose(queued(deploy(false)),queued(convertOne))),
    NoLongerHuman:card(cards.R29,queued(transform(10,'all'))),
    Wilderness:card(cards.R30,compose(queued(transform(1,'any')),queued(deploy(true)))),
    SkyFalls:card(cards.R31,compose(block([8,12]),queued(openDomain([1,2])),queued(removeBlock),attack([20,28]),thunder([6,9]))),
  }};
}});
}
