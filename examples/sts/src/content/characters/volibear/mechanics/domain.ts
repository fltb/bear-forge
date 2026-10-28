import {turns} from '../../../../rules/turns.ts';
import type {TurnActor} from '../../../../rules/turns.types.ts';
import {actionQueue} from '../../../../rules/combat-actions.ts';
import {cardEffects,type CardHitReceipt} from '../../../../rules/card-effects.ts';
import {enemies} from '../../../../rules/enemies.ts';
import {resources} from '../../../../rules/resources.ts';
import {lightning} from './lightning.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import {cardPiles} from '../../../../rules/card-piles.ts';
import type {PileCard} from '../../../../rules/card-piles.types.ts';
import {effectPolicy,EffectKind,type EffectQualification} from '../../../../rules/effect-policy.ts';

type Domain={battle:number;until:number|null;drawnTurn:number;lastPlay:number};
type DrawPolicy={exhaust:boolean;ownEffects:boolean;replacementDraws:number};
const schema=z.object({battle:z.int32().nonnegative(),until:z.int32().positive().nullable(),drawnTurn:z.int32(),lastPlay:z.int32()});

/** One combat-wide state. Turn-based qualification includes the next normal start draw;
 * null is the permanent duration. Enemy effect gates are composed separately.
 */
export const volibearDomain=rules.defineRules({requires:[turns,cardEffects,enemies,resources,lightning,battles,cardPiles,cardInstances,effectPolicy],build(m){
  const state=m.own(rules.defineComponent({schema:schema.nullable(),initial:()=>null}));
  const find=rules.defineQuery({input:z.number(),output:z.number().nullable(),reads:[state],base:(r,battle)=>{
    const ids=r.entities(state).filter(id=>r.component(id,state)?.battle===battle);
    if(ids.length>1)throw Error('Duplicate combat domain');return ids[0]??null;
  }});
  const current=rules.defineQuery({input:z.number(),output:schema.nullable(),reads:[state],dependencies:[find],base:(r,battle)=>{const id=r.query(find,battle);return id===null?null:r.component(id,state);}});
  const active=rules.defineQuery({input:z.number(),output:z.boolean(),dependencies:[current,battles.exports.status],base:(r,battle)=>{
    const d=r.query(current,battle),b=r.query(battles.exports.status,battle);return d!==null&&b.outcome===0&&(d.until===null||b.turn<d.until||b.turn===d.until&&d.drawnTurn<b.turn);
  }});
  const get=rules.defineQuery({input:z.number(),output:schema,reads:[state],base:(r,id)=>r.component(id,state)!});
  const write=m.atom({input:z.object({entity:z.number(),value:schema}),output:z.undefined(),reads:[],writes:[state],emits:[],run(_r,i){return{writes:[{entity:i.entity,component:state,value:i.value}],events:[],result:undefined};}});
  const replacementDraws=1,attachmentDamage=4;
  const allowedEffects:readonly EffectKind[]=[EffectKind.Attack,EffectKind.Block,EffectKind.Strength,EffectKind.BattleFact];
  const cleanse=rules.modify(cardPiles.exports.drawPolicy,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<PileCard,DrawPolicy>>(),output:z.boolean(),reads:[state],dependencies:[active,cardPiles.exports.bindings,cardInstances.exports.metadata],base:(r,c)=>{
      const d=r.component(c.source,state),p=r.query(cardPiles.exports.bindings,c.input.piles),type=r.query(cardInstances.exports.metadata,c.input.card).type;
      return d!==null&&d.battle===p.battle&&r.query(active,d.battle)&&(type===3||type===4);
    }}),
    transform:()=>({exhaust:true,ownEffects:false,replacementDraws}),
  });
  const suppress=rules.modify(effectPolicy.exports.allowed,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<EffectQualification,boolean>>(),output:z.boolean(),reads:[state],dependencies:[active,battles.exports.status],base:(r,c)=>{
      const d=r.component(c.source,state);if(d===null||!r.query(active,d.battle))return false;
      const enemies=r.query(battles.exports.status,d.battle).enemies;
      const benefit=c.input.target===undefined||enemies.includes(c.input.target)?c.input.polarity:-c.input.polarity;
      return enemies.includes(c.input.actor)&&benefit>0;
    }}),
    transform:(_r,c)=>c.value&&allowedEffects.includes(c.input.effect),
  });
  const attached=rules.on(cardEffects.exports.hitResolved,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<CardHitReceipt>>(),output:z.boolean(),reads:[state],dependencies:[active,cardInstances.exports.metadata],base:(r,c)=>{const d=r.component(c.source,state);return d!==null&&d.battle===c.event.use.battle&&r.query(active,d.battle)&&d.lastPlay!==c.event.use.play&&c.event.request.attack&&c.event.use.triggerOnUse&&!c.event.use.purgeOnUse&&r.query(cardInstances.exports.metadata,c.event.use.card).type===0;}}),
    effect:rules.defineEffect<rules.ReactionContext<CardHitReceipt>,void>(b=>rules.sequence(
      rules.call(write,{entity:b.read(v=>v.input.source),value:b.read(v=>({...v.query(get,v.input.source),lastPlay:v.input.event.use.play}))}),
      rules.call(lightning.exports.resolve,{battle:b.read(v=>v.input.event.use.battle),owner:b.read(v=>v.input.owner),base:attachmentDamage,exclude:null}),
    )),
  });
  const expire=rules.defineEffect<{entity:number;turn:number},void>(b=>rules.call(write,{entity:b.read(v=>v.input.entity),value:b.read(v=>({...v.query(get,v.input.entity),drawnTurn:v.input.turn}))}));
  const afterDraw=rules.on(turns.exports.playerPostDrawRelics,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<TurnActor>>(),output:z.boolean(),reads:[state],base:(r,c)=>r.component(c.source,state)?.battle===c.event.battle}),
    effect:rules.defineEffect<rules.ReactionContext<TurnActor>,void>(b=>rules.enqueue(expire,{entity:b.read(v=>v.input.source),turn:b.read(v=>v.query(battles.exports.status,v.input.event.battle).turn)},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.battle).scope),eligible:'captured'})),
  });
  const noDeferred=rules.modify(battles.exports.victoryDeferred,{condition:rules.defineQuery({input:z.custom<rules.ModifierContext<number,boolean>>(),output:z.boolean(),reads:[state],dependencies:[active],base:(r,c)=>r.component(c.source,state)?.battle===c.input&&r.query(active,c.input)}),transform:()=>false});
  const cancelPending=rules.defineEffect<number,void>(b=>rules.forEach(b.read(v=>v.query(battles.exports.status,v.input).enemies),actor=>rules.forEach(b.read(v=>{const id=v.query(enemies.exports.forActor,v.get(actor));return id===null?[]:[id];}),enemy=>rules.when(b.read(v=>v.query(enemies.exports.current,v.get(enemy)).halfDead),rules.call(enemies.exports.setFlags,{enemy,halfDead:false})))));
  const kind=m.kind({config:z.undefined(),setup:schema,components:[state],initialize:rules.defineEffect<rules.EntityLifecycle<Domain>,void>(b=>rules.sequence(
    rules.call(write,{entity:b.read(v=>v.input.entity),value:b.read(v=>v.input.setup)}),
    ...[attached,afterDraw,noDeferred].map(ability=>rules.install({ability,source:b.read(v=>v.input.entity),owner:b.read(v=>v.query(battles.exports.status,v.input.setup.battle).actor),environment:{},lifetime:b.read(v=>v.input.scope)})),
    rules.install({ability:cleanse,source:b.read(v=>v.input.entity),owner:b.read(v=>v.query(battles.exports.status,v.input.setup.battle).actor),environment:{},lifetime:b.read(v=>v.input.scope)}),
    rules.install({ability:suppress,source:b.read(v=>v.input.entity),owner:b.read(v=>v.query(battles.exports.status,v.input.setup.battle).actor),environment:{},lifetime:b.read(v=>v.input.scope)}),
  ))});
  const definition=rules.defineEntity(kind,undefined);
  const change=()=>rules.defineEffect<{battle:number;turns:number|null},void>(b=>{const entity=b.local<number|null>(),value=b.local<Domain>();return rules.sequence(
    b.assign(entity,rules.query(find,b.read(v=>v.input.battle))),
    b.assign(value,b.read(v=>{
      const before=v.query(current,v.input.battle),turn=v.query(battles.exports.status,v.input.battle).turn;
      if(v.input.turns!==null&&(!Number.isInteger(v.input.turns)||v.input.turns<=0))throw Error('Domain duration must be positive');
      const until=v.input.turns===null||before?.until===null?null:Math.max(turn,before?.until??turn)+v.input.turns;
      return{battle:v.input.battle,until,drawnTurn:before?.drawnTurn??turn,lastPlay:before?.lastPlay??-1};
    })),
    rules.when(b.read(v=>v.get(entity)===null),
      rules.spawnEntity({definition,owner:b.read(v=>v.query(battles.exports.status,v.input.battle).actor),scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),setup:value}),
      rules.call(write,{entity:b.read(v=>v.get(entity)!),value})),
    rules.call(cancelPending,b.read(v=>v.input.battle)),
    rules.call(battles.exports.checkOutcome,b.read(v=>v.input.battle)),
  );});
  const labels:{[key:number]:string}={[EffectKind.Attack]:'攻击',[EffectKind.Block]:'格挡',[EffectKind.Strength]:'力量',[EffectKind.BattleFact]:'战斗事实'};
  const text=`持续期间只压制对敌人有利的特殊效果；保留敌人的负面效果，以及${allowedEffects.map(effect=>labels[effect]).join('、')}；抽到状态或诅咒时禁止其自身效果并消耗，补抽${replacementDraws}张。每张实际攻击在领域内首段普通攻击后附加${attachmentDamage}点全体雷伤，同次重演共享机会。领域覆盖下次正常起手抽牌，抽牌结束后扣1轮；普通展开和延长累加，永久领域不降级。`;
  const describe=(turns:string|null)=>turns===null?'领域持续本场战斗。':`展开领域${turns}轮。`;
  return {exports:{attachmentDamage,active,current,open:change(),extend:change(),text,describe}};
}});
