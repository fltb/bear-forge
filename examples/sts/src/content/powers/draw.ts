import {typedValue} from '../../rules/value.schemas.ts';
import {describeProgram,programText} from '../../rules/program-descriptions.ts';
import {onProgram,modifyProgram} from './reaction-programs.ts';
import {PS} from '../../combat-identifiers.ts';
import {z} from 'zod';
import {rules} from '../../rules/execution.ts';
import {cardPiles} from '../../rules/card-piles.ts';
import {cardInstances} from '../../rules/card-instances.ts';
import {powers} from '../../rules/powers.ts';
import {turns} from '../../rules/turns.ts';
import {ownsTurn} from './turn-hooks.ts';
import {random} from '../../rules/random.ts';
import type {PileCard} from '../../rules/card-piles.types.ts';
import type {TurnActor} from '../../rules/turns.types.ts';
import {counterPolicies,defineDescribedPower,powerAbilities,sequencePowerPrograms} from './utils.ts';
const {defineRules,defineQuery,defineEffect,sequence,call,when}=rules;
export const drawPowers=defineRules({requires:[cardPiles,powers,turns],build(){
  const ownsPile=describeProgram(defineQuery({input:typedValue<rules.ModifierContext<number,boolean>>(),output:z.boolean(),dependencies:[cardPiles.exports.current,powers.exports.enabled,cardPiles.exports.bindings],base:(r,c)=>r.query(cardPiles.exports.bindings,c.input).actor===c.owner&&r.query(powers.exports.enabled,c.source)}),'状态生效且查询牌堆属于持有者');
  const ownsCard=describeProgram(defineQuery({input:typedValue<rules.ReactionContext<PileCard>>(),output:z.boolean(),dependencies:[cardPiles.exports.current,powers.exports.enabled,cardPiles.exports.bindings],base:(r,c)=>r.query(cardPiles.exports.bindings,c.event.piles).actor===c.owner&&r.query(powers.exports.enabled,c.source)}),'状态生效且事件牌堆属于持有者');
  const stopDraw=modifyProgram(cardPiles.exports.canDraw,{condition:ownsPile,transform:describeProgram(()=>false,'不允许抽牌。')});
  const removeNoDraw=onProgram(turns.exports.playerEndPowers,{condition:ownsTurn(),order:{phase:turns.exports.stages.content,priority:16},effect:describeProgram(defineEffect<rules.ReactionContext<TurnActor>,void>(b=>call(powers.exports.remove,b.read(v=>v.input.source))),'移除此状态。')});
  const NoDraw=defineDescribedPower('无法抽牌',{presentation:{key:PS.NO_DRAW,flag:false},...counterPolicies({bits:16,harmful:true,resetWhenInactive:true,zeroIsNoop:true})},powerAbilities(stopDraw,removeNoDraw));
  function randomCombatCost(minimumCost:number,maximumCost:number){
    return describeProgram(defineEffect<rules.ReactionContext<PileCard>,void>(b=>{const cost=b.local<number>();return sequence(
      b.assign(cost,call(random.exports.int,{stream:b.read(v=>v.query(cardPiles.exports.bindings,v.input.event.piles).cardRng),start:minimumCost,end:maximumCost})),
      when(b.read(v=>v.query(cardInstances.exports.current,v.input.event.card).cost!==v.get(cost)),sequence(call(cardInstances.exports.setCostForCombat,{entity:b.read(v=>v.input.event.card),amount:cost}),call(cardInstances.exports.overrideTurnCost,{entity:b.read(v=>v.input.event.card),amount:cost}))),
    );}),`使用牌堆的卡牌随机流生成${minimumCost}–${maximumCost}费用；若不同于当前战斗费用，则将战斗费用及本回合费用覆盖值改为该数值。`);
  }
  const clearFreeOnce=describeProgram(defineEffect<rules.ReactionContext<PileCard>,void>(b=>call(cardInstances.exports.setFlags,{entity:b.read(v=>v.input.event.card),freeToPlayOnce:false,retain:b.read(v=>v.query(cardInstances.exports.current,v.input.event.card).retain)})),'清除一次免费标记，保留现有保留标记。');
  function unlessNegativeCost(child:rules.Effect<rules.ReactionContext<PileCard>,void>){
    const effect=defineEffect<rules.ReactionContext<PileCard>,void>(b=>sequence(when(b.read(v=>v.query(cardInstances.exports.current,v.input.event.card).cost<0),b.return(undefined)),call(child,b.input))),text=programText(child);
    return describeProgram(effect,text===undefined?undefined:`战斗费用为负时跳过，否则：${text}`);
  }
  const confused=onProgram(cardPiles.exports.drawing,{condition:ownsCard,order:{phase:cardPiles.exports.stages.power,priority:0},effect:unlessNegativeCost(sequencePowerPrograms(randomCombatCost(0,3),clearFreeOnce))});
  const Confused=defineDescribedPower('混乱',{presentation:{key:PS.CONFUSED,flag:true},...counterPolicies({bits:16,flag:true,harmful:true,zeroIsNoop:true})},powerAbilities(confused));
  return{exports:{NoDraw:NoDraw.definition,Confused:Confused.definition,programs:{NoDraw,Confused},statusTexts:{NO_DRAW:NoDraw.text,CONFUSED:Confused.text}}};
}});
