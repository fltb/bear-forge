import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {typedValue} from '../../../rules/value.schemas.ts';
import {powers} from '../../../rules/powers.ts';
import {battles} from '../../../rules/battles.ts';
import {damage} from '../../../rules/damage.ts';
import {turns} from '../../../rules/turns.ts';
import {enemies} from '../../../rules/enemies.ts';
import {cardInstances} from '../../../rules/card-instances.ts';
import {attributes} from '../../../rules/attributes.ts';
import type {attackValueSchema} from '../../../rules/attributes.schemas.ts';
import {actionQueue,combatScope} from '../../../rules/combat-actions.ts';
import {basicPowers} from '../../powers/attributes.ts';
import {enemyOperations} from './operations.ts';
import {enemyCardOperations} from './card-operations.ts';
import {resources} from '../../../rules/resources.ts';
import type {HpLost} from '../../../rules/resources.types.ts';
import type {PermanentCardDefinition} from '../../../rules/permanent-decks.types.ts';
import {describeProgram,programText} from '../../cards/shared/program-facts.ts';
import {onProgram,modifyProgram} from '../../powers/reaction-programs.ts';
import type {CardUse} from '../../../rules/card-instances.types.ts';
import type {HpDamageRequest} from '../../../rules/damage.types.ts';
import type {TurnActor} from '../../../rules/turns.types.ts';
import type {PowerDefinition,PowerLifecycle} from '../../../rules/powers.types.ts';

type Read<I,O>=(view:rules.ReadView<I>)=>O;
type Reaction<T>=rules.ReactionContext<T>;
type ReactionSpec<T>=Parameters<typeof rules.on<T>>[1];

/** Only assembly metadata: execution always uses the original TS definitions.
 * Unknown children remain executable, but cannot yield a complete description. */
export function projectChildren<T extends object>(program:T,children:readonly object[],render:(texts:readonly string[])=>string):T{
  const texts=children.map(programText);
  return describeProgram(program,texts.every((text):text is string=>text!==undefined)?render(texts):undefined);
}
// Event identity and ordering are projected by the shared reaction constructor.
export function afterCardUse(spec:ReactionSpec<CardUse>){return onProgram(battles.exports.afterUse,spec);}
export function usedCard(spec:ReactionSpec<CardUse>){return onProgram(battles.exports.used,spec);}
export function blockedHit(spec:ReactionSpec<HpDamageRequest>){return onProgram(damage.exports.blocked,spec);}
export function hpLost(spec:ReactionSpec<HpLost>){return onProgram(resources.exports.hpLost,spec);}
export function wouldDie(spec:ReactionSpec<{entity:number}>){return onProgram(resources.exports.wouldDie,spec);}
export function enemyRoundEnd(spec:ReactionSpec<TurnActor>){return onProgram(turns.exports.enemyRoundEnd,spec);}
export function enemyActionStart(spec:ReactionSpec<TurnActor>){return onProgram(turns.exports.enemyStart,spec);}
export function enemyActionEnd(spec:ReactionSpec<TurnActor>){return onProgram(turns.exports.enemyEnd,spec);}
export function playerEndPowers(spec:ReactionSpec<TurnActor>){return onProgram(turns.exports.playerEndPowers,spec);}

export function firstEnemyCardUse(requireUseTrigger:boolean){
  const condition=rules.defineQuery({input:typedValue<Reaction<CardUse>>(),output:z.boolean(),dependencies:[powers.exports.enabled,powers.exports.current,battles.exports.current,battles.exports.status],base:(r,c)=>
    (!requireUseTrigger||c.event.triggerOnUse)&&r.query(powers.exports.enabled,c.source)&&r.query(powers.exports.current,c.source).registry===r.query(battles.exports.status,c.event.battle).registry&&r.query(battles.exports.status,c.event.battle).enemies[0]===c.owner});
  return describeProgram(condition,`状态生效且持有者为该战斗首位敌人${requireUseTrigger?'，且本次出牌触发使用效果':''}`);
}
export function ownCardCategory(attack:boolean){
  const attackType=0;
  return describeProgram(rules.defineQuery({input:typedValue<Reaction<CardUse>>(),output:z.boolean(),dependencies:[powers.exports.enabled,cardInstances.exports.metadata],base:(r,c)=>
    c.event.owner===c.owner&&r.query(powers.exports.enabled,c.source)&&(r.query(cardInstances.exports.metadata,c.event.card).type===attackType)===attack}),`状态生效且自身使用${attack?'攻击':'非攻击'}牌`);
}
export function ownUnblockedHit(options:{attackOnly:boolean;requireSource:boolean}){
  return describeProgram(rules.defineQuery({input:typedValue<Reaction<HpDamageRequest>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>
    c.event.request.target===c.owner&&(!options.attackOnly||c.event.request.attack)&&(!options.requireSource||c.event.request.source!==null)&&c.event.facts.unblocked>0&&r.query(powers.exports.enabled,c.source)}),`状态生效且自身受到未完全格挡的${options.attackOnly?'攻击':'伤害'}${options.requireSource?'，且伤害来源非空':''}`);
}
export function ownAttackDamagedPlayer(){
  return describeProgram(rules.defineQuery({input:typedValue<Reaction<HpLost>>(),output:z.boolean(),dependencies:[powers.exports.enabled,battles.exports.forRegistry,powers.exports.current,battles.exports.current,battles.exports.status],base:(r,c)=>{
    if(!r.query(powers.exports.enabled,c.source)||!c.event.context?.attack||c.event.context.source!==c.owner||c.event.amount<=0)return false;
    const board=r.query(battles.exports.forRegistry,r.query(powers.exports.current,c.source).registry);
    return board!==null&&r.query(battles.exports.status,board).actor===c.event.entity;
  }}),'状态生效且自身为攻击来源，该战斗玩家实际失去正数生命');
}
export function registryBattle<T>(missingMessage:string):Read<Reaction<T>,number>{
  return describeProgram((v:rules.ReadView<Reaction<T>>)=>{const board=v.query(battles.exports.forRegistry,v.query(powers.exports.current,v.input.source).registry);if(board===null)throw Error(missingMessage);return board;},'状态所在战斗');
}
export function ownDeathWithTargets(){
  const condition=rules.defineQuery({input:typedValue<Reaction<{entity:number}>>(),output:z.boolean(),dependencies:[powers.exports.enabled,powers.exports.current,battles.exports.forRegistry,battles.exports.targets],base:(r,c)=>{if(c.event.entity!==c.owner||!r.query(powers.exports.enabled,c.source))return false;const board=r.query(battles.exports.forRegistry,r.query(powers.exports.current,c.source).registry);return board!==null&&r.query(battles.exports.targets,board).length>0;}});
  return describeProgram(condition,'状态生效，自身即将死亡，且所属战斗仍有可选敌方目标');
}
export function ownerEnemy<T>(missingMessage:string):Read<Reaction<T>,number>{
  return describeProgram((v:rules.ReadView<Reaction<T>>)=>{const enemy=v.query(enemies.exports.forActor,v.input.owner);if(enemy===null)throw Error(missingMessage);return enemy;},'自身对应的敌人');
}
export function enterRebirth<T>(enemy:Read<Reaction<T>,number>,options:{move:number;moveName:string;clear:'all'|'negative';remove:readonly {definition:PowerDefinition;name:string}[];clearBlock:boolean;clearCards:boolean}){
  const effect=rules.defineEffect<Reaction<T>,void>(b=>rules.call(enemyOperations.exports.enterRebirth,{enemy:b.read(enemy),move:options.move,clear:options.clear,remove:options.remove.map(power=>power.definition),clearBlock:options.clearBlock,clearCards:options.clearCards}));
  return projectChildren(effect,[enemy],([target])=>`${target}进入重生阶段，清空${options.clear==='all'?'全部':'负面'}状态${options.remove.length?`，额外移除${options.remove.map(power=>power.name).join('、')}`:''}${options.clearBlock?'，清空格挡':''}${options.clearCards?'，清空卡牌':''}，下一动作设为${options.moveName}`);
}
export function ownTurn(){
  return describeProgram(rules.defineQuery({input:typedValue<Reaction<TurnActor>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.event.actor===c.owner&&r.query(powers.exports.enabled,c.source)}),'状态生效且为持有者的回合');
}
export function owner<T>():Read<Reaction<T>,number>{return describeProgram((v:rules.ReadView<Reaction<T>>)=>v.input.owner,'自身');}
export function noSource<T>():Read<Reaction<T>,null>{return describeProgram((_v:rules.ReadView<Reaction<T>>)=>null,'无来源');}
export function cardUser():Read<Reaction<CardUse>,number>{return describeProgram((v:rules.ReadView<Reaction<CardUse>>)=>v.input.event.owner,'出牌者');}
export function hitAttacker():Read<Reaction<HpDamageRequest>,number>{return describeProgram((v:rules.ReadView<Reaction<HpDamageRequest>>)=>v.input.event.request.source!,'攻击者');}
export function hitSource():Read<Reaction<HpDamageRequest>,number|null>{return describeProgram((v:rules.ReadView<Reaction<HpDamageRequest>>)=>v.input.event.request.source,'本次伤害来源');}
export function unblockedAmount(negative=false):Read<Reaction<HpDamageRequest>,number>{return describeProgram((v:rules.ReadView<Reaction<HpDamageRequest>>)=>negative?-v.input.event.facts.unblocked:v.input.event.facts.unblocked,`${negative?'负的':''}本次未格挡伤害数值`);}
export function cardBattle():Read<Reaction<CardUse>,number>{return describeProgram((v:rules.ReadView<Reaction<CardUse>>)=>v.input.event.battle,'出牌所在战斗');}
export function hitBattle():Read<Reaction<HpDamageRequest>,number>{return describeProgram((v:rules.ReadView<Reaction<HpDamageRequest>>)=>v.input.event.request.battle,'受伤所在战斗');}
export function turnBattle():Read<Reaction<TurnActor>,number>{return describeProgram((v:rules.ReadView<Reaction<TurnActor>>)=>v.input.event.battle,'当前回合战斗');}
export function level<T>():Read<Reaction<T>,number>{return describeProgram((v:rules.ReadView<Reaction<T>>)=>v.query(powers.exports.level,v.input.source),'当前层数');}
export function fixed<T>(amount:number):Read<Reaction<T>,number>{return describeProgram((_v:rules.ReadView<Reaction<T>>)=>amount,String(amount));}

/** Target/source/amount callbacks are the exact operands passed to the queued operation. */
export function queuedRetaliation<T>(operands:{battle:Read<Reaction<T>,number>;source:Read<Reaction<T>,number|null>;target:Read<Reaction<T>,number>;amount:Read<Reaction<T>,number>},options:{position?:'front'|'back';attack:boolean;selfDamage:boolean}){
  const {battle,source,target,amount}=operands;
  const effect=rules.defineEffect<Reaction<T>,void>(b=>rules.enqueue(enemyOperations.exports.retaliate,{battle:b.read(battle),source:b.read(source),target:b.read(target),amount:b.read(amount),attack:options.attack,selfDamage:options.selfDamage},{queue:actionQueue,...(options.position?{position:options.position}:{}),source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,battle(v)).actionScope),eligible:'captured'}));
  return projectChildren(effect,[battle,source,target,amount],([board,from,to,value])=>`在${board}的动作队列${options.position==='front'?'队首':'队尾'}排入${from}对${to}造成${value}${options.attack?'攻击':'非攻击'}伤害${options.selfDamage?'（标记自伤）':'（不标记自伤）'}，捕获后执行并使用该战斗的行动作用域`);
}
export function queuedCard<T>(battle:Read<Reaction<T>,number>,card:{definition:PermanentCardDefinition;name:string;destination:0|1|2|3;shuffle:boolean}){
  const effect=rules.defineEffect<Reaction<T>,void>(b=>rules.enqueue(enemyCardOperations.exports.create,{piles:b.read(v=>v.query(battles.exports.status,battle(v)).piles),definition:card.definition,upgraded:false,specialData:0,destination:card.destination,shuffle:card.shuffle,mutable:null},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,battle(v)).actionScope),eligible:'captured'}));
  const piles=['抽牌堆','手牌','弃牌堆','消耗堆'] as const;
  return projectChildren(effect,[battle],([board])=>`在${board}动作队列队尾排入：生成一张未升级的${card.name}，${card.destination===0&&card.shuffle?'随机洗入':'加入'}${piles[card.destination]}（捕获后执行，使用该战斗的行动作用域）`);
}
export function ownRearHit(){
  const fallback=[1,0] as const;
  const condition=rules.defineQuery({input:typedValue<rules.ModifierContext<z.infer<typeof attackValueSchema>,number>>(),output:z.boolean(),dependencies:[powers.exports.enabled,powers.exports.current,battles.exports.forRegistry,battles.exports.current,battles.exports.targetable,battles.exports.status],base:(r,c)=>{
    if(c.input.target!==c.owner||!r.query(powers.exports.enabled,c.source))return false;
    const id=r.query(battles.exports.forRegistry,r.query(powers.exports.current,c.source).registry);if(id===null)return false;
    const board=r.query(battles.exports.status,id),facing=board.lastTargeted??board.enemies[fallback[0]]??board.enemies[fallback[1]]!;
    return c.input.source!==facing&&r.query(battles.exports.targetable,facing);
  }});
  return describeProgram(condition,`状态生效、自身为受击目标且所属战斗存在；朝向取最近选择的敌人，否则依次取第${fallback.map(index=>index+1).join('、')}位敌人；伤害来源不是朝向敌人且朝向敌人仍可选中`);
}
export function multiplyAttack(multiplier:number){
  return describeProgram((_r:rules.QueryRead,c:rules.ModifierContext<z.infer<typeof attackValueSchema>,number>)=>Math.fround(c.value*Math.fround(multiplier)),`将当前攻击伤害乘以${multiplier}`);
}
export function incomingPlayerAttackPerLayer(scale:number,priority:number){
  const condition=describeProgram(rules.defineQuery({input:typedValue<rules.ModifierContext<z.infer<typeof attackValueSchema>,number>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.input.target===c.owner&&r.query(powers.exports.enabled,c.source)}),'状态生效且自身为玩家攻击目标');
  const transform=describeProgram((r:rules.QueryRead,c:rules.ModifierContext<z.infer<typeof attackValueSchema>,number>)=>Math.fround(c.value*Math.fround(1+Math.fround(r.query(powers.exports.level,c.source)*Math.fround(scale)))),`每层使该攻击伤害提高${scale*100}%`);
  return modifyProgram(attributes.exports.playerAttack,{condition,dependencies:[powers.exports.level],order:{phase:attributes.exports.stages.targetScale,priority},transform});
}
export function applyPower<T>(power:{definition:PowerDefinition;name:string},operands:{target:Read<Reaction<T>,number>;source:Read<Reaction<T>,number|null>;amount:Read<Reaction<T>,number>},debuff:boolean){
  const {target,source,amount}=operands;
  const effect=rules.defineEffect<Reaction<T>,void>(b=>rules.call(enemyOperations.exports.applyPower,{registry:b.read(v=>v.query(powers.exports.current,v.input.source).registry),actor:b.read(target),definition:power.definition,amount:b.read(amount),source:b.read(source),debuff,scope:rules.scopeOf(b.read(v=>v.input.source),combatScope)}));
  return projectChildren(effect,[target,source,amount],([actor,from,value])=>`以${from}为来源，为${actor}施加${value}层${power.name}${debuff?'（标记减益）':'（不标记减益）'}`);
}
export function gainStrength<T>(amount:Read<Reaction<T>,number>){
  const effect=rules.defineEffect<Reaction<T>,void>(b=>rules.call(enemyOperations.exports.applyPower,{registry:b.read(v=>v.query(powers.exports.current,v.input.source).registry),actor:b.read(v=>v.input.owner),definition:basicPowers.exports.Strength,amount:b.read(amount),source:null,debuff:false,scope:rules.scopeOf(b.read(v=>v.input.source),combatScope)}));
  return projectChildren(effect,[amount],([value])=>`自身获得${value}力量`);
}
export function heal<T>(target:Read<Reaction<T>,number>,amount:Read<Reaction<T>,number>){
  const effect=rules.defineEffect<Reaction<T>,void>(b=>rules.call(enemyOperations.exports.heal,{entity:b.read(target),amount:b.read(amount)}));
  return projectChildren(effect,[target,amount],([actor,value])=>`为${actor}恢复${value}生命`);
}
export function ownIncomingHpDamage(){
  return describeProgram(rules.defineQuery({input:typedValue<rules.ReplacementContext<HpDamageRequest>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.value.request.target===c.owner&&r.query(powers.exports.enabled,c.source)}),'状态生效且自身为伤害目标');
}
/** One budget operation: capture remaining allowance, cap, spend that same amount,
 * then return the replacement. The arithmetic does not read the updated counter. */
export function spendDamageBudget(){
  const effect=rules.defineEffect<rules.ReplacementContext<HpDamageRequest>,rules.ReplacementResult<HpDamageRequest>>(b=>{
    const amount=b.local<number>(),remaining=b.local<number>();
    return rules.sequence(
      b.assign(remaining,rules.query(powers.exports.level,b.read(v=>v.input.source))),
      b.assign(amount,b.read(v=>Math.min(v.input.value.request.amount,v.get(remaining)))),
      rules.call(enemyOperations.exports.setCounter,{entity:b.read(v=>v.input.source),next:{level:b.read(v=>v.get(remaining)-v.get(amount)),active:true,justApplied:false}}),
      b.return(b.read(v=>v.get(amount)===v.input.value.request.amount?{kind:'keep',value:v.input.value}:{kind:'change',value:{...v.input.value,request:{...v.input.value.request,amount:v.get(amount)}}})),
    );
  });
  return describeProgram(effect,'将伤害限制为剩余层数与原伤害的较小值，从层数中扣除该额度，再继续处理限额后的伤害（保持生效，清除新施加标记）');
}
export function rememberAppliedAmount(component:rules.Component<number>){
  const effect=rules.defineEffect<PowerLifecycle,void>(b=>rules.updateLocalComponent(b.read(v=>v.input.entity),component,b.read(v=>v.input.setup.amount)));
  return projectChildren(effect,[component],([slot])=>`施加时将本次层数记录为${slot}`);
}
export function attachAfter(...initializers:rules.Effect<PowerLifecycle,void>[]){
  const attach=(abilities:rules.Effect<PowerLifecycle,void>)=>rules.defineEffect<PowerLifecycle,void>(b=>rules.sequence(...initializers.map(effect=>rules.call(effect,b.input)),rules.call(abilities,b.input)));
  return projectChildren(attach,initializers,texts=>`${texts.join('，然后')}，然后安装能力。`);
}
export function resetCounterFrom<T>(component:rules.Component<number>){
  const effect=rules.defineEffect<Reaction<T>,void>(b=>rules.call(enemyOperations.exports.setCounter,{entity:b.read(v=>v.input.source),next:{level:rules.readComponent(b.read(v=>v.input.source),component),active:true,justApplied:false}}));
  return projectChildren(effect,[component],([slot])=>`将层数恢复为${slot}，保持生效并清除新施加标记`);
}
export function sequencePrograms<I>(...children:rules.Effect<I,void>[]){
  const effect=rules.defineEffect<I,void>(b=>rules.sequence(...children.map(child=>rules.call(child,b.input))));
  return projectChildren(effect,children,texts=>texts.join('，然后'));
}
export function whenProgram<I>(condition:Read<I,boolean>,yes:rules.Effect<I,void>,no?:rules.Effect<I,void>){
  const effect=rules.defineEffect<I,void>(b=>no?rules.when(b.read(condition),rules.call(yes,b.input),rules.call(no,b.input)):rules.when(b.read(condition),rules.call(yes,b.input)));
  return projectChildren(effect,[condition,yes,...(no?[no]:[])],([test,then,otherwise])=>`若${test}，${then}${otherwise===undefined?'':`；否则${otherwise}`}`);
}
export function addCounter<T>(amount:number){
  return describeProgram(rules.defineEffect<Reaction<T>,void>(b=>rules.call(enemyOperations.exports.setCounter,{entity:b.read(v=>v.input.source),next:b.read(v=>({level:v.query(powers.exports.level,v.input.source)+amount,active:true,justApplied:false}))})),`层数增加${amount}，保持生效并清除新施加标记`);
}
export function setCounter<T>(amount:number){
  return describeProgram(rules.defineEffect<Reaction<T>,void>(b=>rules.call(enemyOperations.exports.setCounter,{entity:b.read(v=>v.input.source),next:{level:amount,active:true,justApplied:false}})),`层数设为${amount}，保持生效并清除新施加标记`);
}
