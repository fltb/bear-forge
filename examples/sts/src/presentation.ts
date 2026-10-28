import {rules} from './rules/execution.ts';
import {actRecovery} from './program/progression.ts';
import {cardInstances} from './rules/card-instances.ts';
import {adventureContent} from './program/adventure.ts';
import {volibearContent} from './program/volibear-content.ts';
import {cards} from './cards.ts';
import {volibearCardDescriptions} from './content/characters/volibear/cards/metadata.ts';
import {relicTexts} from './content/relics/descriptions.ts';
import {potionTexts} from './content/potions/descriptions.ts';
import {potionRequiresEnemy} from './content/potions/metadata.ts';
import {statusTexts,volibearMechanics} from './content/powers/descriptions.ts';
import {relicId,potionId} from './identifiers.ts';
import {PS,MS} from './combat-identifiers.ts';
import {intentTexts} from './content/enemies/intent-texts.ts';
import type {Action,Observation} from './game.schemas.ts';
const volibear=new Map(Object.values(volibearCardDescriptions).map(d=>[d.id,d]));
const relicNumbers=new Map<number,string>(Object.entries(relicId).map(([k,v])=>[v,k]));
relicNumbers.set(Math.max(...Object.values(relicId))+1,'VOLIBEAR_HUNTERS_HEART');
relicNumbers.set(Math.max(...Object.values(relicId))+2,'VOLIBEAR_IMMORTAL_HEART');
const potionNumbers=new Map<number,string>(Object.entries(potionId).map(([k,v])=>[v,k]));
const cardConfigurations=new Map([...adventureContent.cards.exports.definitions,...volibearContent.cards.exports.definitions].map(({id,definition})=>[id,rules.entityConfiguration(cardInstances.exports.kind,definition)]));
export function describeCard(id:string,upgraded=false){
  const configuration=cardConfigurations.get(id),metadata=configuration?.metadata,text=configuration?.text;
  if(!metadata||!text)throw Error('Missing card presentation: '+id);
  return{id,name:metadata.name,upgraded,text,variant:metadata.variants[upgraded?1:0],type:metadata.type};
}
function relicName(id:number){const key=relicNumbers.get(id);if(!key)throw Error('Unknown relic number '+id);return key;}
function potionName(id:number){const key=potionNumbers.get(id);if(!key)throw Error('Unknown potion number '+id);return key;}
export function describeRelic(id:number|string){const name=typeof id==='number'?relicName(id):id;return {id:name,text:relicTexts[name]!};}
export function describePotion(id:number){const name=potionName(id);return {id:name,text:potionTexts[name]!};}
function roomLabel(room:string){return room==='EVENT'?'? 未知房间（进入后确定类型）':room;}
export function enemyIntentLabel(b:NonNullable<Observation['battle']>,index:number){
  if(b.intentHidden)return '隐藏';
  const intent=b.intents?.find(i=>i.index===index),monster=b.monsters.find(m=>m.index===index);
  if(!intent)return '无';
  if(intent.acted)return '已行动（本轮不再行动）';
  const name=intent.name==='LAGAVULIN_SLEEP'
    ?`${monster&&(BigInt(monster.statusBits)&(1n<<BigInt(MS.ASLEEP)))!==0n?'睡眠':'已唤醒，当前仍为过渡行动'}${intent.attack?'':'（本次不攻击）'}`
    :`${intentTexts[intent.name as keyof typeof intentTexts]??(intent.hits>0?'攻击':'特殊行动')}（${intent.name}）`;
  return name+(intent.hits>0?`，${intent.attack?'攻击':'非攻击伤害'} ${intent.attackDamage}×${intent.hits}（格挡与伤害减免前）`:'');
}
const selectionTypes:Record<number,string>={1:'变换',2:'变换并升级',3:'升级',4:'移除',5:'复制',6:'获得',7:'设为固有',8:'献祭'};
const selectionTasks:Record<string,string>={ARMAMENTS:'升级',CODEX:'选择加入抽牌堆',DISCOVERY:'选择加入手牌',DUAL_WIELD:'复制',EXHAUST_ONE:'消耗',EXHAUST_MANY:'消耗',EXHUME:'从消耗堆回收',FORETHOUGHT:'放至抽牌堆底并减费',GAMBLE:'弃置并抽等量牌',HEADBUTT:'置于抽牌堆顶',LIQUID_MEMORIES_POTION:'回收并本回合0费',SECRET_TECHNIQUE:'检索技能',SECRET_WEAPON:'检索攻击',WARCRY:'置于抽牌堆顶','弃牌':'弃置','消耗牌':'消耗','预见':'预见：弃置选中的牌，其余保持顺序','保留攻击':'保留','复制攻击':'复制','回收攻击':'回收','强化攻击':'强化','兽化手牌':'兽化','检索牌':'检索'};
export function describeAction(o:Observation,bits:number){
  const g=o.game,b=o.battle,index=bits&65535,target=(bits>>>16)&8191,type=bits>>>29;
  function action(kind:string,label:string,details:Record<string,unknown>={}){return{kind,label,details};}
  if(b){
    if(type===4)return action('end-turn','结束回合');
    if(type===1){
      const potion=g.potions[index]!,name=potionName(potion);
      if(target>5)return action('discard-potion',`丢弃药水[${index}] ${name}`,{slot:index});
      const targeted=potionRequiresEnemy(potion);
      return action('drink-potion',`喝下药水[${index}] ${name}${targeted?` → 敌人[${target}] ${b.monsters.find(m=>m.index===target)?.name??''}`:''}`,{slot:index,target:targeted?target:null});
    }
    if(type===2||type===3){
      const task=b.select?.task;if(!task)throw Error('Selection has no presentation context');
      if(task==='迎战 / 放弃')return action('confirm-engage',index===0?'迎战':'放弃迎战',{engage:index===0});
      const verb=selectionTasks[task];if(!verb)throw Error('Missing selection task '+task);
      const indices=type===3?Array.from({length:29},(_,i)=>i).filter(i=>(bits&0x1fffffff)&(1<<i)):[index];
      const candidates=b.select?.candidates;if(!candidates)throw Error('Selection candidates are not published');
      const skip=type===2&&index===b.select?.skipIndex,selected=skip?[]:indices.map(i=>{const c=candidates.find(c=>c.index===i);if(!c)throw Error('Missing selection candidate '+i);return c;});
      return action(skip?'skip-selection':'select-cards',skip?'跳过选择':`${verb}：${selected.length?selected.map(c=>`[${c.index}] ${describeCard(c.card.id,c.card.upgraded).name}${c.card.upgraded?'+':''}`).join('、'):'不选择任何牌'}`,{task,indices:selected.map(c=>c.index)});
    }
    if(type!==0)throw Error('Unknown combat action '+bits);
    const c=b.hand[index];if(!c)throw Error('Missing playable hand card');const d=describeCard(c.id,c.upgraded);
    return action('play-card',`打出[${index}] ${d.name}${c.upgraded?'+':''}（${c.cost===-1?'X费，当前'+b.player.energy+'能量':'支付'+(b.costs?.[String(bits)]??c.costForTurn)+'能量'}）${d.variant.target?` → 敌人[${target}] ${b.monsters.find(m=>m.index===target)?.name??''}`:''}`,{hand:index,target:d.variant.target?target:null,card:c});
  }
  if(bits>=0x80000000){const slot=bits&255;return action(bits&0x40000000?'discard-potion':'drink-potion',`${bits&0x40000000?'丢弃':'喝下'}药水[${slot}] ${potionName(g.potions[slot]!)}`,{slot});}
  const kind=(bits>>>27)&7,i=bits&255,j=(bits>>>8)&255;
  if(g.screen==='MAP_SCREEN'){const y=g.y+1,node=g.map.nodes.find(n=>n.x===i&&n.y===y);return action('travel',`前往 (${i},${y}) ${y===15?'Boss':roomLabel(node?.room??'下一节点')}`,{x:i,y});}
  if(g.screen==='REST_ROOM'){const label=['休息：回复最大生命30%（遗物修正另计）','锻造：升级1张牌','回忆：获得红钥匙','举重：力量+1','抽烟：移除1张牌','挖掘：获得遗物','离开'][i];if(!label)throw Error('Unknown rest option');return action('rest-option',label,{option:i});}
  if(g.screen==='TREASURE_ROOM')return action(i===0?'open-chest':'leave',i===0?'打开宝箱':'离开宝箱');
  if(g.screen==='BOSS_RELIC_REWARDS')return action(i===3?'skip-relic':'take-relic',i===3?'跳过Boss遗物':`获得 ${relicName(g.bossRelics![i]!)}`,{index:i});
  if(g.screen==='CARD_SELECT'){const card=g.select?.cards[i]?.card,verb=selectionTypes[g.select?.type??-1];if(!card||!verb)throw Error('Missing permanent selection context');return action('select-card',`${verb}[${i}] ${describeCard(card.id,card.upgraded).name}${card.upgraded?'+':''}`,{index:i,card});}
  if(g.screen==='REWARDS'){
    const r=g.rewards!;
    if(kind===6)return action('leave','结束领奖（放弃剩余奖励）');
    if(kind===0){if(j===5)return action('skip-card',`跳过第${i}组卡牌奖励${g.relics.some(r=>r.id==='SINGING_BOWL')?'，最大生命+2':''}`,{offer:i});const c=r.cards[i]?.[j];if(!c)throw Error('Missing reward card');return action('take-card',`获得 ${describeCard(c.id,c.upgraded).name}${c.upgraded?'+':''}`,{offer:i,index:j,card:c});}
    if(kind===1)return action('take-gold',`领取${r.gold[i]}金币`,{index:i});
    if(kind===2)return action('take-key',r.sapphireKey?'获得蓝钥匙，放弃宝箱遗物':'获得绿钥匙');
    if(kind===3)return action('take-potion',`领取 ${potionName(r.potions[i]!)}`,{index:i});
    if(kind===4)return action('take-relic',`领取 ${relicName(r.relics[i]!)}`,{index:i});
  }
  if(g.screen==='SHOP_ROOM'){
    const s=g.shop!;
    if(kind===6)return action('leave','离开商店');
    if(kind===5)return action('remove-card',`支付${s.removeCost}金币移除1张牌`);
    if(kind===0){const c=s.cards[i]!;return action('buy-card',`支付${s.prices[i]}金币购买 ${describeCard(c.id,c.upgraded).name}${c.upgraded?'+':''}`,{index:i,card:c});}
    if(kind===3)return action('buy-potion',`支付${s.prices[10+i]}金币购买 ${potionName(s.potions[i]!)}`,{index:i});
    if(kind===4)return action('buy-relic',`支付${s.prices[7+i]}金币购买 ${relicName(s.relics[i]!)}`,{index:i});
  }
  if(g.screen==='EVENT_SCREEN'){
    if(g.neow){const n=g.neow[i];if(!n)throw Error('Missing Neow option');return action('neow',`${n.description}；代价：${adventureContent.neow.exports.describeDrawback(n.drawback,g)}`,{option:i});}
    const extra=g.optionDetails?.[String(i)];
    if(extra===undefined)throw Error(`Missing executable event option description ${g.eventName}/${i}`);
    return action('event-option',extra,{event:g.eventName,option:i});
  }
  throw Error(`Missing action presentation ${g.screen}/${bits}`);
}
export function presentDecision(observation:Observation,actions:readonly Action[]){
  const visible=new Map<string,{id:string;upgraded:boolean}>();
  const visit=(value:unknown):void=>{if(!value||typeof value!=='object')return;if('id' in value&&typeof value.id==='string'&&'upgraded' in value&&typeof value.upgraded==='boolean')visible.set(value.id+':'+value.upgraded,{id:value.id,upgraded:value.upgraded});for(const child of Object.values(value))visit(child);};
  if(observation.battle){visit(observation.battle.hand);visit(observation.battle.select?.candidates);}else visit(observation.game);
  const g=observation.game,relics=new Set(g.relics.map(r=>r.id));for(const n of [...g.rewards?.relics??[],...g.shop?.relics??[],...g.bossRelics??[]])relics.add(relicName(n));
  const potions=new Set([...g.potions,...g.rewards?.potions??[],...g.shop?.potions??[]].map(potionName));
  const requireText=(book:Record<string,string>,id:string)=>{const text=book[id];if(!text)throw Error('Missing rules text '+id);return{id,text};};
  const mechanics:Record<string,string>&{'幕间恢复':string}={'幕间恢复':actRecovery.text,...(g.deck.some(c=>c.id.startsWith('VOLIBEAR_'))?volibearMechanics:{}),...Object.fromEntries((observation.battle?.intentHidden?[]:observation.battle?.intents??[]).filter(i=>i.name==='LAGAVULIN_SLEEP').map(i=>[`敌人[${i.index}]行动`,enemyIntentLabel(observation.battle!,i.index)]))};
  return{actions:actions.map((a,id)=>({id,bits:a.bits,...describeAction(observation,a.bits)})),rules:{cards:[...visible.values()].map(c=>describeCard(c.id,c.upgraded)),relics:[...relics].map(id=>requireText(relicTexts,id)),potions:[...potions].map(id=>requireText(potionTexts,id)),statuses:Object.entries(statusTexts).filter(([name])=>observation.battle?.effects?.some(e=>e.name===name)||['STRENGTH','DEXTERITY','WEAK','VULNERABLE','FRAIL','ARTIFACT'].includes(name)).map(([name,text])=>({name,text,playerId:PS[name as keyof typeof PS]??null,enemyId:MS[name as keyof typeof MS]??null})),mechanics}};
}

/** Assembly-time completeness check, called before creating a playable session. */
export function validatePresentationCatalog(){
  for(const id of [...Object.keys(cards),...volibear.keys()])describeCard(id);
  for(const id of Object.keys(relicId))if(!relicTexts[id])throw Error('Missing relic description '+id);
  for(const id of Object.keys(potionId))if(!potionTexts[id])throw Error('Missing potion description '+id);
  // Event text is validated against each actually published option by describeAction.
}

export function formatDecision(o:Observation,p:ReturnType<typeof presentDecision>){
  const g=o.game,b=o.battle,lines=[`Act ${g.act} / floor ${g.floor} / ${g.screen} / HP ${g.hp}/${g.maxHp} / gold ${g.gold}`,`钥匙：红${g.keys.red?'✓':'×'} 绿${g.keys.green?'✓':'×'} 蓝${g.keys.blue?'✓':'×'}`];
  if(b){
    lines.push(`回合 ${b.turn+1}；能量 ${b.player.energy}；格挡 ${b.player.block}；力量 ${b.player.strength}；敏捷 ${b.player.dexterity}；抽牌堆 ${b.drawCount} 张`);
    for(const m of b.monsters)lines.push(`敌人[${m.index}] ${m.name}：HP ${m.hp}/${m.maxHp}，格挡${m.block}；意图 ${enemyIntentLabel(b,m.index)}`);
    for(const [i,c]of b.hand.entries())lines.push(`手牌[${i}] ${describeCard(c.id,c.upgraded).name}${c.upgraded?'+':''}，牌面费用${c.costForTurn}，${c.retain?'保留，':''}${describeCard(c.id,c.upgraded).text}`);
    for(const e of b.effects??[])lines.push(`状态 ${e.target} ${e.name} ${e.level}${e.active?'':'（当前未激活）'}：${e.text}`);
    if(b.domain?.active)lines.push(`领域生效：${b.domain.untilTurn===null?'本场战斗':`至第${b.domain.untilTurn}回合开始`}`);
    if(b.pendingRepeats)lines.push(`待用攻击重复效果：${b.pendingRepeats}`);
    if(b.pendingEngageDiscounts)lines.push(`待用迎战减费：${b.pendingEngageDiscounts}`);
    for(const c of b.cardGrowth??[])if(c.permanentAttackBonus||c.nextAttackBonus||c.nextPlayDiscount)lines.push(`${b.hand.find(h=>h.uniqueId===c.uniqueId)?.id??c.uniqueId}：本战固定伤害+${c.permanentAttackBonus}，下次攻击+${c.nextAttackBonus}${c.nextPlayDiscount?'，下次打出减1费':''}`);
    for(const c of b.select?.candidates??[])lines.push(`候选[${c.index}] ${describeCard(c.card.id,c.card.upgraded).name}：${describeCard(c.card.id,c.card.upgraded).text}`);
  }else{
    lines.push(p.rules.mechanics['幕间恢复']);
    lines.push('牌组：'+g.deck.map(c=>describeCard(c.id,c.upgraded).name+(c.upgraded?'+':'')).join('、'));
    if(g.screen==='MAP_SCREEN')for(const y of [...new Set(g.map.nodes.filter(n=>n.room!=='NONE').map(n=>n.y))].sort((a,b)=>a-b))lines.push(`地图第${y}行：`+g.map.nodes.filter(n=>n.y===y&&n.room!=='NONE').map(n=>`x${n.x} ${roomLabel(n.room)} → ${n.edges.join(',')}`).join(' | '));
    if(g.screen==='EVENT_SCREEN')lines.push('事件：'+g.eventName);
    if(g.select)lines.push(`选择${g.select.remaining}张牌，操作：${selectionTypes[g.select.type]}`);
    for(const c of p.rules.cards)lines.push(`${c.name}${c.upgraded?'+':''}：${c.text}`);
  }
  for(const r of p.rules.relics)lines.push(`遗物 ${r.id}：${r.text}`);
  for(const x of p.rules.potions)if(x.id!=='EMPTY_POTION_SLOT'&&x.id!=='INVALID')lines.push(`药水 ${x.id}：${x.text}`);
  lines.push(...p.actions.map(a=>`${a.id}: ${a.label}`),'核对当前动作的动词、名称、目标和费用；动作编号会随决策重新分配。','输入 编号 理由，或 observe / quit > ');
  return lines.join('\n')+'\n';
}
