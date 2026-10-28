import {routeMap,routeDetails} from './sts-tui-map.ts';
import {describeCard,describeRelic,describePotion,presentDecision} from '@bear-forge/sts';
import {enemyIntentLabel} from '../../../examples/sts/src/presentation.ts';
import type {Action} from '@bear-forge/sts';
import type {EventBatch} from '../../../examples/sts/src/simulator.types.ts';
import {encounterId} from '../../../examples/sts/src/identifiers.ts';

// Terminal cells: combining marks are zero-width; CJK and emoji use two cells.
export function cellWidth(character:string){
  if(/\p{Mark}|[\u200d\ufe0e\ufe0f]/u.test(character))return 0;
  const c=character.codePointAt(0)!;
  return c>=0x1100&&(c<=0x115f||c===0x2329||c===0x232a||(c>=0x2e80&&c<=0xa4cf)||(c>=0xac00&&c<=0xd7a3)||(c>=0xf900&&c<=0xfaff)||(c>=0xfe10&&c<=0xfe6f)||(c>=0xff01&&c<=0xff60)||(c>=0xffe0&&c<=0xffe6)||(c>=0x1f000&&c<=0x1ffff)||c>=0x20000)?2:1;
}
export function clean(text:string){return text.replace(/[\x00-\x1f\x7f-\x9f]/g,' ');}
export function fit(text:string,width:number){let out='',cells=0;for(const c of clean(text)){const n=cellWidth(c);if(cells+n>width)break;out+=c;cells+=n;}return out+' '.repeat(Math.max(0,width-cells));}
export function wrap(text:string,width:number){if(width<1)return [''];const lines:string[]=[];let line='',cells=0;for(const c of clean(text)){const n=cellWidth(c);if(cells+n>width){lines.push(line);line='';cells=0;}line+=c;cells+=n;}lines.push(line);return lines;}
export const tabs=['场面','牌堆','地图','记录','规则','详情'];
const costText=(cost:number)=>cost===-1?'X':cost<0?'不可打出':String(cost);
type VisibleCard={id:string;upgraded:boolean;misc?:number;specialData?:number;cost?:number;costForTurn?:number;freeToPlayOnce?:boolean;retain?:boolean};
function cardCostLabel(batch:EventBatch,card:VisibleCard,hand?:number,payment?:number){
  const b=batch.state.observation.battle;
  const costs=payment!==undefined?[payment]:hand===undefined?[]:Object.entries(b?.costs??{}).filter(([bits])=>(Number(bits)&65535)===hand).map(([,cost])=>cost);
  const current=card.costForTurn??card.cost??describeCard(card.id,card.upgraded).variant.cost;
  if(costs.length){
    const low=Math.min(...costs),high=Math.max(...costs);
    return `${current===-1?'X→':''}${low===high?low:`${low}–${high}`}费`;
  }
  if(current<-1)return '不可打出';
  if(card.freeToPlayOnce)return '0费';
  return current===-1?`X费${b?`(${b.player.energy}能量)`:''}`:`${current}费`;
}
function compactCard(batch:EventBatch,card:VisibleCard,index?:number){
  const d=describeCard(card.id,card.upgraded);
  return `${index===undefined?'':`[${index}] `}${cardCostLabel(batch,card,index)} ${d.name}${card.upgraded?'+':''}`;
}
export function cardLines(card:VisibleCard){
  const d=describeCard(card.id,card.upgraded),v=d.variant;
  return [`${d.name}${card.upgraded?'+':''} · ${['攻击','技能','能力','诅咒','状态'][d.type]??d.type} · 基础费用 ${costText(card.cost??v.cost)}${card.costForTurn===undefined?'':` · 本回合费用 ${costText(card.costForTurn)}`}；实际支付见合法动作`,
    [v.innate?'固有':'',v.ethereal?'虚无':'',v.exhaust?'消耗':'',card.retain??v.retain?'保留':'',card.freeToPlayOnce?'本次免费':'',v.target?'需要敌方目标':''].filter(Boolean).join('；'),
    ...((card.misc??card.specialData??0)!==0?[`卡牌累计值 ${card.misc??card.specialData}`]:[]),d.text].filter(Boolean);
}
function inventoryLines(batch:EventBatch){
  const g=batch.state.observation.game;
  return [`持有遗物 ${g.relics.length} 个`,...g.relics.map(r=>`${r.id} · 当前计数 ${r.data}：${describeRelic(r.id).text}`),
    `药水栏 ${g.potions.length} 槽`,...g.potions.map((id,index)=>{const p=describePotion(id);return `药水[${index}] ${p.id}：${p.text}`;})];
}
type PresentedAction=ReturnType<typeof decisionPresentation>['actions'][number];
export function turnThreat(batch:EventBatch){
  const b=batch.state.observation.battle;
  if(!b||b.intentHidden||!b.intents)return null;
  const attacks=b.intents.filter(i=>i.attack&&!i.acted&&b.monsters.some(m=>m.index===i.index&&m.hp>0));
  const total=attacks.reduce((n,i)=>n+i.attackDamage*i.hits,0),loss=Math.max(0,total-b.player.block);
  return{total,loss,hp:b.player.hp,lethal:loss>=b.player.hp&&b.player.hp>0,formula:attacks.map(i=>`[${i.index}] ${i.attackDamage}×${i.hits}`).join(' + ')||'无普通攻击'};
}
export function damageLines(batch:EventBatch,current:PresentedAction){
  const b=batch.state.observation.battle,terms=b?.damagePreview?.[String(current.bits)];
  if(!b)return [];
  if(!terms?.length){
    const card=current.details.card as VisibleCard|undefined;
    const description=card?describeCard(card.id,card.upgraded):undefined;
    return description&&(description.type===0||description.text.includes('雷伤'))?['动态或随机伤害：按下方牌效结算']:[];
  }
  const groups=new Map<string,typeof terms[number]>();
  for(const term of terms.filter(t=>t.hits>0)){
    const key=JSON.stringify([term.label,term.target,term.amount]),previous=groups.get(key);
    groups.set(key,{...term,hits:term.hits+(previous?.hits??0)});
  }
  const lines=[...groups.values()].map(t=>`${t.label.replace(/（.*）/,'')} ${t.target===null?'全体':`[${t.target}]`}：${t.amount}×${t.hits}`);
  const totals=b.monsters.filter(m=>m.hp>0).map(m=>`[${m.index}] ${terms.filter(t=>t.target===null||t.target===m.index).reduce((n,t)=>n+t.amount*t.hits,0)}`);
  return [`已列合计：${totals.join(' / ')}`, ...lines,'格挡前参考；同类合并，条件效果另计'];
}
/** Warning from the published card text and current intents, never a simulated card result. */
export function engageLines(batch:EventBatch,current:PresentedAction){
  const b=batch.state.observation.battle,card=current.details.card as VisibleCard|undefined;
  if(!b||!card||current.kind!=='play-card')return [];
  const text=describeCard(card.id,card.upgraded).text,all=text.includes('迎战全体敌人');
  if(!all&&!text.includes('迎战目标'))return [];
  if(b.intentHidden||!b.intents)return ['⚠ 迎战会让目标立即行动；意图未知'];
  const targets=b.intents.filter(i=>(all||i.index===current.details.target)&&!i.acted&&b.monsters.some(m=>m.index===i.index&&m.hp>0));
  if(!targets.length)return ['目标已行动或已倒下，本轮不会再次行动'];
  return ['⚠ 迎战：目标现在行动',...targets.map(i=>i.attack?`[${i.index}] 当前攻击 ${i.attackDamage}×${i.hits} = ${i.attackDamage*i.hits}`:`[${i.index}] 当前为非攻击行动`),'本牌格挡、击杀、虚弱按牌面顺序结算'];
}
/** Short labels retain the original action/target; costs come from the public rule result. */
export function actionMatches(batch:EventBatch,action:PresentedAction,filter:string){
  return `${action.label} ${actionLabel(batch,action)}`.toLowerCase().includes(filter.toLowerCase());
}
export function actionLabel(batch:EventBatch,action:PresentedAction){
  if(action.kind==='discard-potion')return action.label.replace('丢弃','丢弃（不生效）');
  if(action.kind==='travel')return routeDetails(batch,action.details.x as number,action.details.y as number)[0]!;
  const card=action.details.card as VisibleCard|undefined;
  if(action.kind!=='play-card')return card?`${cardCostLabel(batch,card)} · ${action.label}`:action.label;
  const b=batch.state.observation.battle!,hand=action.details.hand as number;
  return `[${hand}] ${cardCostLabel(batch,card!,hand,b.costs?.[String(action.bits)])} ${describeCard(card!.id,card!.upgraded).name}${card!.upgraded?'+':''}${action.details.target===null?'':` → [${action.details.target}]`}`;
}
export function needsConfirmation(batch:EventBatch,action:PresentedAction){
  return ['discard-potion','leave','skip-card','skip-relic','end-turn'].includes(action.kind)||engageLines(batch,action)[0]?.startsWith('⚠')===true;
}
/** Actual observed changes, not a forecast or a second effect executor. */
export function resultSummary(before:EventBatch,after:EventBatch){
  const a=before.state.observation,b=after.state.observation,parts:string[]=[];
  if(a.game.hp!==b.game.hp)parts.push(`生命 ${a.game.hp}→${b.game.hp}`);
  if(a.battle&&b.battle){
    if(a.battle.player.energy!==b.battle.player.energy)parts.push(`能量 ${a.battle.player.energy}→${b.battle.player.energy}`);
    if(a.battle.player.block!==b.battle.player.block)parts.push(`格挡 ${a.battle.player.block}→${b.battle.player.block}`);
  }
  const loss=after.events.reduce((n,{event})=>event.kind==='detail'&&event.type==='damage'&&event.data.targetRole==='enemy'?n+Number(event.data.lost??0):n,0);
  const drawn=after.events.filter(({event})=>event.kind==='detail'&&event.type==='draw').length;
  if(loss)parts.push(`敌人失血 ${loss}`);
  if(drawn)parts.push(`抽牌 ${drawn}`);
  if(a.battle&&!b.battle)parts.push('战斗结束');
  if(after.state.termination==='death')parts.push('战斗失败');
  return parts.length?`上一步：${parts.join(' · ')}`:'上一步已执行并保存';
}
function actionDetails(batch:EventBatch,current:PresentedAction|undefined,candidate?:VisibleCard){
  const g=batch.state.observation.game,b=batch.state.observation.battle;
  const card=candidate??current?.details.card as VisibleCard|undefined;
  const lines=current?.kind==='travel'?routeDetails(batch,current.details.x as number,current.details.y as number):current?[current.label]:candidate?['当前多选候选']:['没有匹配的操作'];
  if(current?.kind==='end-turn'){
    const threat=turnThreat(batch);
    lines.push(...(threat?[threat.lethal?'⚠ 致死风险':'本轮攻击估算',`${threat.formula} = ${threat.total}`,`现有格挡 ${b!.player.block} · 预计失血 ${threat.loss}`,`生命 ${threat.hp} → ${Math.max(0,threat.hp-threat.loss)}`]:['意图隐藏或未知，无法估算攻击']), '仅按当前普通攻击与格挡估算；未计回合末触发、特殊减伤或复活');
  }
  if(current?.kind==='play-card')lines.push(...engageLines(batch,current),...damageLines(batch,current));
  if(card){
    const d=describeCard(card.id,card.upgraded),v=d.variant;
    if(candidate)lines.push(`${d.name}${card.upgraded?'+':''}`);
    lines.push([['攻击','技能','能力','诅咒','状态'][d.type],v.exhaust?'消耗':'',v.ethereal?'虚无':'',(card.retain??v.retain)?'保留':'',card.freeToPlayOnce?'本次免费':''].filter(Boolean).join(' · '),d.text);
    const growth=b?.cardGrowth?.find(c=>c.uniqueId===(card as VisibleCard&{uniqueId?:number}).uniqueId);
    if(growth)lines.push(...[growth.permanentAttackBonus?`本战强化 +${growth.permanentAttackBonus}`:'',growth.nextAttackBonus?`下次攻击 +${growth.nextAttackBonus}`:'',growth.nextPlayDiscount?'下次打出减费1':''].filter(Boolean));
  }
  if(current){
    const i=current.details.index as number,slot=current.details.slot as number;
    const potion=current.kind==='buy-potion'?g.shop?.potions[i]:current.kind==='take-potion'?g.rewards?.potions[i]:['drink-potion','discard-potion'].includes(current.kind)?g.potions[slot]:undefined;
    const relic=current.kind==='buy-relic'?g.shop?.relics[i]:current.kind==='take-relic'?(g.bossRelics??g.rewards?.relics)?.[i]:undefined;
    if(current.kind==='discard-potion')lines.push('⚠ 丢弃药水，不会触发任何药水效果。','需要使用效果时，请选择「喝下药水」。');
    else if(potion!==undefined)lines.push(describePotion(potion).text);
    if(relic!==undefined)lines.push(describeRelic(relic).text);
  }
  return lines;
}
const statusNames:Record<string,string>={STRENGTH:'力量',DEXTERITY:'敏捷',WEAK:'虚弱',VULNERABLE:'易伤',FRAIL:'脆弱',ARTIFACT:'人工制品',POISON:'中毒'};
function effectLabel(effect:{name:string;level:number;active:boolean}){return `${statusNames[effect.name]??effect.name} ${effect.level}${effect.active?'':'（未生效）'}`;}
function compactEffects(effects:{name:string;level:number;active:boolean}[]){
  const counts=new Map<string,number>();
  for(const effect of effects){const label=effectLabel(effect);counts.set(label,(counts.get(label)??0)+1);}
  return [...counts].map(([label,count])=>count>1?`${label} ×${count}份`:label);
}
function offerLines(batch:EventBatch){
  const g=batch.state.observation.game,lines:string[]=[];
  const priceText=(price:number)=>price<0?'已售罄／不可用':`${price} 金币${price>g.gold?'（金币不足）':''}`;
  const item=(kind:string,id:number,price?:number)=>{const d=kind==='遗物'?describeRelic(id):describePotion(id);return `${kind} ${d.id}${price===undefined?'':` · ${priceText(price)}`}：${d.text}`;};
  if(g.shop){const s=g.shop;lines.push('商店全部商品（可否购买以右侧合法动作为准）');
    s.cards.forEach((c,i)=>{lines.push(`商品卡牌[${i}] · ${priceText(s.prices[i]!)}`,...cardLines(c));});
    s.relics.forEach((id,i)=>lines.push(item('遗物',id,s.prices[7+i])));s.potions.forEach((id,i)=>lines.push(item('药水',id,s.prices[10+i])));lines.push(`移除卡牌：${priceText(s.removeCost)}`);
  }
  if(g.rewards){const r=g.rewards;lines.push('当前奖励',...r.gold.map(n=>`金币 ${n}`));r.cards.forEach((cards,i)=>{lines.push(`选牌奖励组[${i}]`);cards.forEach(c=>lines.push(...cardLines(c)));});r.relics.forEach(id=>lines.push(item('遗物',id)));r.potions.forEach(id=>lines.push(item('药水',id)));if(r.sapphireKey)lines.push('蓝钥匙：与本次宝箱遗物二选一');if(r.emeraldKey)lines.push('绿钥匙奖励');}
  if(g.bossRelics)lines.push('Boss 遗物奖励',...g.bossRelics.map(id=>item('遗物',id)));
  if(g.select){lines.push(`选牌进度：还需 ${g.select.remaining} 张；已选 ${g.select.selected.length} 张`);g.select.selected.forEach(c=>lines.push('已选：',...cardLines(c.card)));g.select.cards.forEach((c,i)=>lines.push(`候选[${i}]`,...cardLines(c.card)));}
  return lines;
}
export function decisionPresentation(batch:EventBatch){const request=batch.state.request;return presentDecision(batch.state.observation,(request?.options.kind==='exact'?request.options.values:[]) as Action[]);}
export function chooseMultiple(batch:EventBatch,indices:readonly number[]){
  return decisionPresentation(batch).actions.find(a=>{
    const selected=a.details.indices as number[]|undefined;
    return a.bits>>>29===3&&selected?.length===indices.length&&selected.every(index=>indices.includes(index));
  });
}
export function eventLines(batch:EventBatch){
  return batch.events.flatMap(({sequence,event})=>{
    if(event.kind!=='detail'||event.type==='entity-view')return [];
    const d=event.data,who=(value:unknown)=>{const e=batch.identities[String(value)];return e?.kind==='player'?'玩家':e?.kind==='enemy'?`敌人[${e.index}]`:String(value??'');};
    const title:Record<string,string>={'card-play':'出牌','draw':'抽牌','discard':'弃牌','exhaust':'消耗','damage':'伤害','hp-loss':'失去生命','heal':'治疗','block-gain':'获得格挡','energy-gain':'获得能量','gold-gain':'获得金币','enemy-action':'敌人行动','enemy-action-complete':'敌人行动完成','player-turn-start':'玩家回合开始','player-turn-end':'玩家回合结束','battle-start':'战斗开始','battle-end':'战斗结束','cards-obtained':'获得卡牌','card-removed':'移除卡牌','status-attached':'获得状态','status-change':'状态变化','card-change':'卡牌变化'};
    if(event.type==='resource-change')return [`${sequence} ${who(d.entity)} ${d.resource}: ${d.before} → ${d.after}`];
    if(event.type==='damage')return [`${sequence} ${who(d.source)} → ${who(d.target)}：实际失血 ${d.lost}，格挡吸收 ${d.blocked}`];
    const card=typeof d.id==='string'?describeCard(d.id,Boolean(d.upgraded)).name:'';
    return [`${sequence} ${title[event.type]??event.type} ${card||d.name||who(d.actor??d.entity??d.enemy)}${d.amount===undefined?'':` ${d.amount}`}${d.after===undefined?'':` → ${d.after}`}`];
  });
}
export function contentLines(batch:EventBatch,tab:number,log:readonly string[],p=decisionPresentation(batch)){
  const o=batch.state.observation,g=o.game,b=o.battle;
  if(tab===3)return [...log];
  if(tab===2)return routeMap(batch,p);
  if(tab===1){
    const lines=[`永久牌组 ${g.deck.length} 张`,...g.deck.flatMap(c=>cardLines(c))];
    if(b)for(const [name,cards]of [['手牌',b.hand],['弃牌',b.discard],['消耗',b.exhaust]] as const){lines.push(`${name} ${cards.length} 张`,...cards.flatMap(c=>cardLines(c)));}
    if(b?.draw)lines.push(`抽牌堆 ${b.draw.length} 张（Frozen Eye 公开顺序）`,...b.draw.flatMap(c=>cardLines(c)));
    if(b&&!b.draw)lines.push(`抽牌堆 ${b.drawCount} 张：顺序未揭示`);
    return lines;
  }
  if(tab===5)return ['全部合法操作（长选项可在这里滚动读完）',...p.actions.map(a=>a.label),...offerLines(batch),...(b?.select?.candidates??[]).flatMap(c=>[`候选[${c.index}]`,...cardLines(c.card)])];
  if(tab===4)return [...inventoryLines(batch),...(b?.effects??[]).map(e=>`${e.target} · ${effectLabel(e)}：${e.text}`),...p.rules.statuses.map(s=>`${statusNames[s.name]??s.name}：${s.text}`),...Object.entries(p.rules.mechanics).map(([name,text])=>`${name}：${text}`)];
  if(b){
    const lines:string[]=[];
    const threat=turnThreat(batch);
    if(threat)lines.push(`敌方剩余总攻击 ${threat.total}`,`${threat.formula}`,threat.lethal?`⚠ 致死风险：预计失血 ${threat.loss} ≥ HP ${threat.hp}`:`按现有格挡估算失血 ${threat.loss}`,'仅普通攻击估算；触发另计','');
    else lines.push('敌方总攻击：未知（意图隐藏）','');
    lines.push(`手牌 ${b.hand.length} · 抽牌 ${b.drawCount} · 弃牌 ${b.discard.length} · 消耗 ${b.exhaust.length}`);
    if(b.domain?.active)lines.push(`领域 · ${b.domain.untilTurn===null?'本战永久':`至第${b.domain.untilTurn}回合起手结束`}`,'敌方有利特效暂停；负面效果、攻击、力量、格挡保留');
    const playerEffects=(b.effects??[]).filter(e=>e.target==='player'&&e.active&&(e.level!==0||e.name==='雷势'&&batch.state.character==='volibear'));
    const playerValues=[['STRENGTH',b.player.strength],['DEXTERITY',b.player.dexterity],['ARTIFACT',b.player.artifact]] as const;
    const playerStatuses=[...compactEffects(playerEffects),...playerValues.filter(([name,value])=>value!==0&&!playerEffects.some(e=>e.name===name||e.name===statusNames[name])).map(([name,value])=>`${statusNames[name]} ${value}`)];
    if(playerStatuses.length)lines.push(playerStatuses.join(' · '));
    if(b.pendingRepeats)lines.push(`待用重演 ${b.pendingRepeats}`);
    if(b.pendingEngageDiscounts)lines.push(`待用迎战减费 ${b.pendingEngageDiscounts}`);
    if(lines.length)lines.push('');
    for(const m of b.monsters){
      lines.push(`[${m.index}] ${m.name}  HP ${m.hp}/${m.maxHp}${m.block?`  格挡 ${m.block}`:''}`);
      if(m.hp<=0&&!b.intents?.some(i=>i.index===m.index))continue;
      // Preserve the authoritative intent wording and damage; omit only its internal move id.
      lines.push(`意图 ${enemyIntentLabel(b,m.index).replace(/（[A-Z][A-Z0-9_]*）/g,'').replace('（格挡与伤害减免前）','')}`);
      const effects=(b.effects??[]).filter(e=>e.target===`enemy:${m.index}`&&e.active&&e.level!==0);
      const values=[['STRENGTH',m.strength],['WEAK',m.weak],['VULNERABLE',m.vulnerable],['ARTIFACT',m.artifact],['POISON',m.poison]] as const;
      const statuses=[...effects.map(effectLabel),...values.filter(([name,value])=>value!==0&&!effects.some(e=>e.name===name||e.name===statusNames[name])).map(([name,value])=>`${statusNames[name]} ${value}`)];
      if(statuses.length)lines.push(statuses.join(' · '));
      lines.push('');
    }
    const playable=new Set(p.actions.filter(a=>a.kind==='play-card').map(a=>a.details.hand));
    lines.push('手牌 · 当前费用',b.hand.length?b.hand.map((c,i)=>`${compactCard(batch,c,i)}${!b.select&&!playable.has(i)&&c.costForTurn>=-1?'（暂不可打出）':''}`).join('  /  '):'（空）');
    if(b.select)lines.push(`选择：${b.select.task}`,`数量 ${b.select.canPickAnyNumber?'任意':b.select.pickCount} · ${b.select.canPickZero?'可不选':'必须选择'}`);
    return lines;
  }
  const places:Record<string,string>={MAP_SCREEN:'选择下一站',REST_ROOM:'营火',SHOP_ROOM:'商店',REWARDS:'领取奖励',BOSS_RELIC_REWARDS:'选择 Boss 遗物',TREASURE_ROOM:'宝箱',CARD_SELECT:'选择卡牌',EVENT_SCREEN:g.neow?'涅奥的祝福':g.eventName};
  const lines=[places[g.screen]??g.screen,'',`牌组 ${g.deck.length} 张 · 遗物 ${g.relics.length} 个`,`钥匙：红${g.keys.red?'✓':'×'} 绿${g.keys.green?'✓':'×'} 蓝${g.keys.blue?'✓':'×'}`];
  if(g.screen==='MAP_SCREEN')lines.push('',`本幕 Boss：${Object.entries(encounterId).find(([,id])=>id===g.boss)?.[0]??g.boss}`,'完整路线见「地图」页');
  if(g.select)lines.push('',`还需选择 ${g.select.remaining} 张 · 已选 ${g.select.selected.length} 张`);
  if(g.shop)lines.push('','全部商品与价格见「详情」页');
  return lines;

}

export type TuiModel={batch:EventBatch;tab:number;scroll:number;selected:number;filter:string;filtering:boolean;message:string;busy:boolean;log:string[];focus:'actions'|'content';confirm:boolean;multi:number[]|null};
// Style only after measuring text so ANSI sequences never consume terminal cells.
const tone=(text:string,style:string)=>`\x1b[${style}m${text}\x1b[0m`;
function ellipsis(text:string,width:number){return [...clean(text)].reduce((n,c)=>n+cellWidth(c),0)>width?fit(text,width-1)+'…':fit(text,width);}
export function renderTui(model:TuiModel,columns:number,rows:number){
  const width=Math.max(20,columns-1),height=Math.max(8,rows),state=model.batch.state;
  if(columns<60||rows<16)return '\x1b[H'+['STS TUI — 窗口过小',`当前 ${columns} × ${rows}，请调整为至少 60 × 16。`,'已暂停接收动作；q 保存退出。'].map(s=>fit(s,width)).join('\r\n')+'\x1b[J';
  const p=decisionPresentation(model.batch),actions=p.actions.filter(a=>actionMatches(model.batch,a,model.filter));
  if(model.tab===0&&state.observation.battle&&!state.observation.battle.select&&model.multi===null&&columns>=80&&rows>=24)return renderCombatScene(model,columns,rows,actions);
  const left=Math.floor((width-3)*.52),right=width-left-3,body=height-6;
  const current=model.multi===null?actions[model.selected]:undefined;
  const candidate=model.multi===null?undefined:state.observation.battle?.select?.candidates?.[model.selected];
  const details=actionDetails(model.batch,current,candidate?.card);
  const extra=model.tab===5?['当前操作',...details,...(model.message?['界面消息：'+model.message]:[]),'']:[];
  const content=[...extra,...contentLines(model.batch,model.tab,model.log,p)].flatMap(line=>wrap(line,left));
  const maxScroll=Math.max(0,content.length-body),offset=Math.min(model.scroll,maxScroll);
  model.scroll=offset;
  const choices=model.multi===null?actions.map(a=>actionLabel(model.batch,a)):(state.observation.battle?.select?.candidates??[]).map(c=>`${model.multi!.includes(c.index)?'[x]':'[ ]'} [${c.index}] ${compactCard(model.batch,c.card)}`);
  const detailRows=details.flatMap(line=>wrap(line,right));
  const previewHeight=Math.max(3,Math.floor(body*.4));
  const listHeight=body-previewHeight-2;
  const start=Math.max(0,Math.min(model.selected-Math.floor(listHeight/2),choices.length-listHeight));
  const preview=detailRows.slice(0,previewHeight);
  if(detailRows.length>previewHeight)preview[previewHeight-1]='…「详情」页可滚动阅读全文';
  const outcome={playing:'进行中',death:'死亡','act3-clear':'第三幕通关','heart-victory':'第四幕碎心'}[state.termination];
  const g=state.observation.game,b=state.observation.battle;
  const title=`${state.character==='volibear'?'沃利贝尔':'铁甲战士'} A${g.ascension} · ${g.act}幕 ${g.floor}层${state.termination==='playing'?'':` · ${outcome}`}`;
  const resources=`HP ${g.hp}/${g.maxHp}${b?`  能量 ${b.player.energy}  格挡 ${b.player.block}  回合 ${b.turn+1}`:`  金币 ${g.gold}`}`;
  const range=content.length>body?` · ${offset+1}–${Math.min(offset+body,content.length)}/${content.length}`:'';
  const heading=`${model.focus==='content'?'▸ ':''}${tabs[model.tab]}${range}`;
  const actionHeading=`${model.focus==='actions'?'▸ ':''}操作 ${choices.length?model.selected+1:0}/${choices.length}${model.filter?` / ${model.filter}`:''}`;
  const lines=[tone(fit(title,width),'2'),tone(fit(resources,width),'1;36'),fit(tabs.map((t,i)=>i===model.tab?`[${t}]`:t).join('  '),width),tone(fit(heading,left)+' │ '+fit(actionHeading,right),'2')];
  for(let i=0;i<body;i++){
    let actionCell:string;
    if(i<listHeight){const index=start+i,label=choices[index];const text=ellipsis(label===undefined?'':`${index===model.selected?'› ':'  '}${label}`,right);actionCell=index===model.selected&&label!==undefined?tone(text,model.focus==='actions'?'7':'1'):text;}
    else if(i===listHeight)actionCell=tone(fit('─'.repeat(right),right),'2');
    else if(i===listHeight+1)actionCell=tone(fit('选中详情',right),'1');
    else {const text=preview[i-listHeight-2]??'';actionCell=text.startsWith('⚠')?tone(fit(text,right),'1;31'):fit(text,right);}
    const contentCell=fit(content[offset+i]??'',left);
    lines.push((content[offset+i]?.startsWith('⚠')?tone(contentCell,'1;31'):contentCell)+tone(' │ ','2')+actionCell);
  }
  const lethal=current?.kind==='end-turn'&&turnThreat(model.batch)?.lethal;
  const status=model.busy?'正在执行并保存…':model.confirm?`${lethal?'⚠ 致死风险！':''}再次 Enter 确认：${current?actionLabel(model.batch,current):'所选组合'}；Esc 取消`:lethal?'⚠ 按当前攻击与格挡估算会致死；Enter 查看确认，Esc 返回':model.filtering?`筛选：${model.filter}（Enter 完成 / Esc 清空）`:model.multi!==null?`多选模式 · 已选 ${model.multi.length} 张 · Space 勾选 / Enter 提交 / Esc 返回`:model.message||'↑↓ 选择操作，右侧预览详情';
  lines.push(tone(ellipsis(status,width),lethal?'1;31':model.confirm?'1;33':'2'));
  lines.push(tone(fit('↑↓ 选择  Enter 执行  ←→ 页  / 筛选  q 退出  ? 帮助',width),'2'));
  return '\x1b[H'+lines.join('\r\n')+'\x1b[J';
}

/** Keep danger, the selected card and its target visible together at decision time. */
function renderCombatScene(model:TuiModel,columns:number,rows:number,actions:PresentedAction[]){
  const batch=model.batch,state=batch.state,g=state.observation.game,b=state.observation.battle!,width=columns-1;
  const left=Math.floor((width-3)*.38),right=width-left-3,detailHeight=Math.min(9,Math.max(7,Math.floor(rows*.24))),body=rows-8-detailHeight;
  const current=actions[model.selected],target=current?.details.target,threat=turnThreat(batch);
  const outcome={playing:'进行中',death:'死亡','act3-clear':'第三幕通关','heart-victory':'第四幕碎心'}[state.termination];
  const lines=[tone(fit(`${state.character==='volibear'?'沃利贝尔':'铁甲战士'} A${g.ascension} · ${g.act}幕 ${g.floor}层 · ${outcome}`,width),'2'),
    tone(fit(`HP ${g.hp}/${g.maxHp}   能量 ${b.player.energy}   格挡 ${b.player.block}   回合 ${b.turn+1}`,width),'1;36'),
    fit(tabs.map((t,i)=>i===model.tab?`[${t}]`:t).join('  '),width),
    tone(fit(threat?`敌方剩余总攻击 ${threat.total}  −  当前格挡 ${b.player.block}  →  估算失血 ${threat.loss}`:'敌方剩余总攻击：未知（意图隐藏）',width),threat?.lethal?'1;31':'1'),
    tone(fit(threat?.lethal?`⚠ 致死风险：当前生命 ${threat.hp}；仅普通攻击估算，触发另计`:'仅按当前普通攻击与格挡估算；出牌、特殊减伤及触发会改变结果',width),threat?.lethal?'1;31':'2'),
    tone(fit(`${model.focus==='content'?'▸ ':''}敌人 / 状态（PgUp/Dn滚动）`,left)+' │ '+fit(`${model.focus==='actions'?'▸ ':''}手牌 / 操作 ${actions.length?model.selected+1:0}/${actions.length}${model.filter?' / '+model.filter:''}`,right),'1')];
  const enemies:string[]=[];
  for(const m of b.monsters){
    if(m.index<0||m.hp<=0&&!b.intents?.some(i=>i.index===m.index))continue;
    enemies.push(`${target===m.index?'▶ ':'  '}[${m.index}] ${m.name}`,`HP ${m.hp}/${m.maxHp}${m.block?`  格挡 ${m.block}`:''}`);
    const intent=b.intents?.find(i=>i.index===m.index);
    enemies.push(b.intentHidden?'意图 隐藏':intent?.acted?'已行动 · 本轮不再行动':intent?.attack?`将攻击 ${intent.attackDamage}×${intent.hits} = ${intent.attackDamage*intent.hits}`:enemyIntentLabel(b,m.index).replace(/（[A-Z][A-Z0-9_]*）/g,''));
    const effects=(b.effects??[]).filter(e=>e.target===`enemy:${m.index}`&&e.active&&e.level!==0);
    const values=[['STRENGTH',m.strength],['WEAK',m.weak],['VULNERABLE',m.vulnerable],['ARTIFACT',m.artifact],['POISON',m.poison]] as const;
    const statuses=[...compactEffects(effects),...values.filter(([name,value])=>value!==0&&!effects.some(e=>e.name===name||e.name===statusNames[name])).map(([name,value])=>`${statusNames[name]} ${value}`)];
    if(statuses.length)enemies.push(statuses.join(' · '));
    enemies.push('');
  }
  enemies.push(`手牌 ${b.hand.length} · 抽牌堆 ${b.drawCount}`,`弃牌 ${b.discard.length} · 消耗 ${b.exhaust.length}`);
  if(b.domain?.active)enemies.push(`领域：${b.domain.untilTurn===null?'本战永久':`至第${b.domain.untilTurn}回合起手结束`}`);
  const playerEffects=(b.effects??[]).filter(e=>e.target==='player'&&e.active&&(e.level!==0||e.name==='雷势'&&state.character==='volibear'));
  enemies.push(...compactEffects(playerEffects));
  for(const [name,value] of [['STRENGTH',b.player.strength],['DEXTERITY',b.player.dexterity],['ARTIFACT',b.player.artifact]] as const){
    if(value&&!playerEffects.some(e=>e.name===name||e.name===statusNames[name]))enemies.push(`${statusNames[name]} ${value}`);
  }
  if(b.pendingRepeats)enemies.push(`待用重演 ${b.pendingRepeats}`);
  if(b.pendingEngageDiscounts)enemies.push(`待用迎战减费 ${b.pendingEngageDiscounts}`);
  const content=enemies.flatMap(line=>wrap(line,left));
  model.scroll=Math.min(model.scroll,Math.max(0,content.length-body));
  const targetLine=content.findIndex(line=>line.startsWith('▶'));
  if(model.focus==='actions'&&targetLine>=0){
    if(targetLine<model.scroll)model.scroll=targetLine;
    else if(targetLine+2>=model.scroll+body)model.scroll=Math.min(Math.max(0,content.length-body),targetLine+3-body);
  }
  const playable=new Set(decisionPresentation(batch).actions.filter(a=>a.kind==='play-card').map(a=>a.details.hand));
  const unavailable=b.hand.flatMap((card,i)=>playable.has(i)?[]:[{label:`— ${compactCard(batch,card,i)}（不可打出）`,index:-1}]);
  const choices:{label:string;index:number}[]=[];
  let inserted=false;
  actions.forEach((action,index)=>{
    if(!inserted&&action.kind!=='play-card'){choices.push(...unavailable);inserted=true;}
    choices.push({label:actionLabel(batch,action),index});
  });
  if(!inserted)choices.push(...unavailable);
  const selectedRow=choices.findIndex(row=>row.index===model.selected),start=Math.max(0,Math.min(selectedRow-Math.floor(body/2),choices.length-body));
  for(let i=0;i<body;i++){
    const row=choices[start+i],selected=row?.index===model.selected&&row.index>=0;
    const lhs=content[model.scroll+i]??'',rhs=row?`${selected?'› ':'  '}${row.label}`:'';
    lines.push((lhs.startsWith('▶')?tone(fit(lhs,left),'1;36'):fit(lhs,left))+' │ '+(selected?tone(ellipsis(rhs,right),model.focus==='actions'?'7':'1'):row?.index===-1?tone(ellipsis(rhs,right),'2'):ellipsis(rhs,right)));
  }
  const card=current?.details.card as VisibleCard|undefined;
  const label=current?actionLabel(batch,current):'没有匹配的操作';
  lines.push(tone(fit(`选中详情 · ${label}（尚未执行）`,width),'1;36'));
  const detail:string[]=[];
  if(current?.kind==='play-card'&&card){
    const cost=b.costs?.[String(current.bits)],enemy=b.monsters.find(m=>m.index===target);
    detail.push(`${cost===undefined?'费用见选项':`支付 ${cost} 能量，余 ${Math.max(0,b.player.energy-cost)}`}${enemy?` · 目标 [${enemy.index}] ${enemy.name}`:' · 无指定敌人'}${describeCard(card.id,card.upgraded).variant.exhaust?' · 消耗':''} · ${card.upgraded?'升级牌':'基础牌'}`);
    const engage=engageLines(batch,current);
    if(engage[0]?.startsWith('⚠'))detail.push(`⚠ 迎战立即让目标行动；${engage.slice(1,-1).join('；')||'意图未知'}；先后顺序见下方牌效`);
    else if(engage.length)detail.push(engage[0]!);
    detail.push(describeCard(card.id,card.upgraded).text);
    const damage=damageLines(batch,current);
    if(damage.length)detail.push(`伤害参考（格挡前，条件效果另计）：${damage.slice(0,-1).join('；')||damage[0]}`);
  }else detail.push(...actionDetails(batch,current).slice(current?1:0));
  const detailRows=detail.flatMap(line=>wrap(line,width));
  for(let i=0;i<detailHeight-1;i++){
    const text=detailRows.length>detailHeight-1&&i===detailHeight-2?'…「详情」页查看完整牌效与伤害构成':detailRows[i]??'';
    lines.push(text.startsWith('⚠')?tone(fit(text,width),'1;31'):fit(text,width));
  }
  const engage=current&&engageLines(batch,current)[0]?.startsWith('⚠');
  const status=model.busy?'正在执行并保存…':model.confirm?`⚠ 再次 Enter 确认：${label}；Esc 取消`:model.filtering?`筛选：${model.filter}`:engage?'⚠ 迎战会立即让目标行动；Enter 查看确认':current?.kind==='end-turn'&&threat?.lethal?'⚠ 致死风险！Enter 查看确认':model.message||'↑↓ 选牌和目标；底部查看牌效，Enter 执行';
  lines.push(tone(ellipsis(status,width),model.confirm||engage||current?.kind==='end-turn'&&threat?.lethal?'1;33':'2'));
  lines.push(tone(fit('↑↓ 选牌/目标  Enter 执行  ←→ 页  PgUp/Dn 状态  / 筛选  q 退出',width),'2'));
  return '\x1b[H'+lines.join('\r\n')+'\x1b[J';
}
