import {describeCard,describeRelic,describePotion,formatDecision,presentDecision} from '@bear-forge/sts';
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
export const tabs=['场面','卡组与牌堆','地图','结算记录','规则说明','当前动作'];
const costText=(cost:number)=>cost===-1?'X':cost<0?'不可打出':String(cost);
type VisibleCard={id:string;upgraded:boolean;misc?:number;specialData?:number;cost?:number;costForTurn?:number;freeToPlayOnce?:boolean;retain?:boolean};
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
  if(tab===2)return [`当前 (${g.x},${g.y})；连线列出下一行 x 坐标；? 为未知房间`,`本幕公开 Boss：${Object.entries(encounterId).find(([,id])=>id===g.boss)?.[0]??g.boss}`,...g.map.nodes.filter(n=>n.room!=='NONE').sort((a,b)=>a.y-b.y||a.x-b.x).map(n=>`${n.x===g.x&&n.y===g.y?'●':' '} (${n.x},${n.y}) ${n.room}${n.x===g.map.burningEliteX&&n.y===g.map.burningEliteY?' [燃烧精英 / 绿钥匙]':''} → ${n.edges.join(', ')}`)];
  if(tab===1){
    const lines=[`永久牌组 ${g.deck.length} 张`,...g.deck.flatMap(c=>cardLines(c))];
    if(b)for(const [name,cards]of [['手牌',b.hand],['弃牌',b.discard],['消耗',b.exhaust]] as const){lines.push(`${name} ${cards.length} 张`,...cards.flatMap(c=>cardLines(c)));}
    if(b?.draw)lines.push(`抽牌堆 ${b.draw.length} 张（Frozen Eye 公开顺序）`,...b.draw.flatMap(c=>cardLines(c)));
    if(b&&!b.draw)lines.push(`抽牌堆 ${b.drawCount} 张：顺序未揭示`);
    return lines;
  }
  if(tab===5)return ['全部合法操作（长选项可在这里滚动读完）',...p.actions.map(a=>a.label),...offerLines(batch),...p.rules.cards.flatMap(c=>cardLines(c)),...p.rules.relics.map(r=>`${r.id}：${r.text}`),...p.rules.potions.map(r=>`${r.id}：${r.text}`)];
  if(tab===4)return [...inventoryLines(batch),...p.rules.statuses.map(s=>`${s.name}：${s.text}`),...Object.entries(p.rules.mechanics).map(([name,text])=>`${name}：${text}`)];
  // Reuse authoritative presentation; strip the old numeric-input footer.
  const formatted=formatDecision(o,{...p,actions:[]}).split('\n');
  const summary=[`遗物：${g.relics.map(r=>`${r.id}[${r.data}]`).join('、')||'无'}`,`药水：${g.potions.map((id,i)=>`[${i}] ${describePotion(id).id}`).join('、')||'无'}`];
  if(b){summary.push(`牌堆：手牌 ${b.hand.length} / 抽牌 ${b.drawCount} / 弃牌 ${b.discard.length} / 消耗 ${b.exhaust.length}`);
    for(const m of b.monsters)summary.push(`敌人[${m.index}] ${m.name}：力量 ${m.strength} / 虚弱 ${m.weak} / 易伤 ${m.vulnerable} / 人工制品 ${m.artifact} / 中毒 ${m.poison}`);
    if(b.select)summary.push(`选择：${b.select.task}；数量 ${b.select.canPickAnyNumber?'任意':b.select.pickCount}；${b.select.canPickZero?'可不选':'必须选择'}`);
  }
  const original=formatted.slice(0,-3).filter(Boolean),head=b?3+b.monsters.length:2;
  return [...original.slice(0,head),...summary,...original.slice(head),...offerLines(batch),'近期结算',...log.slice(-12)];
}

export type TuiModel={batch:EventBatch;tab:number;scroll:number;selected:number;filter:string;filtering:boolean;message:string;busy:boolean;log:string[];focus:'actions'|'content';confirm:boolean;multi:number[]|null};
export function renderTui(model:TuiModel,columns:number,rows:number){
  const width=Math.max(20,columns-1),height=Math.max(8,rows),state=model.batch.state;
  if(columns<60||rows<16)return '\x1b[H'+['STS TUI — 窗口过小',`当前 ${columns} × ${rows}，请调整为至少 60 × 16。`,'已暂停接收动作；q 保存退出。'].map(s=>fit(s,width)).join('\r\n')+'\x1b[J';
  const p=decisionPresentation(model.batch),actions=p.actions.filter(a=>a.label.toLowerCase().includes(model.filter.toLowerCase()));
  const left=Math.floor((width-3)*.52),right=width-left-3,body=height-7;
  const current=model.multi===null?actions[model.selected]:undefined;
  const selectedCard=current?.details.card as VisibleCard|undefined;
  const candidate=model.multi===null?undefined:state.observation.battle?.select?.candidates?.[model.selected];
  const extra=model.tab===5?['界面消息：'+model.message,...(current?['当前操作：'+current.label]:[]),...(selectedCard?cardLines(selectedCard):[]),...(candidate?['当前多选候选',...cardLines(candidate.card)]:[]),'']:[];
  const content=[...extra,...contentLines(model.batch,model.tab,model.log,p)].flatMap(line=>wrap(line,left));
  const maxScroll=Math.max(0,content.length-body),offset=Math.min(model.scroll,maxScroll);
  model.scroll=offset;
  const actionRows:string[]=[];let selectedLine=0;
  const choices=model.multi===null?actions.map(a=>a.label):(model.batch.state.observation.battle?.select?.candidates??[]).map(c=>`${model.multi!.includes(c.index)?'[x]':'[ ]'} ${describeCard(c.card.id,c.card.upgraded).name}${c.card.upgraded?'+':''}（完整文案见当前动作页）`);
  for(const [index,label]of choices.entries()){
    if(index===model.selected)selectedLine=actionRows.length;
    const text=(index===model.selected?'▶ ':'  ')+label;
    actionRows.push(...wrap(text,right));
  }
  const start=Math.max(0,selectedLine-Math.floor(body/3));
  const outcome={playing:'进行中',death:'死亡', 'act3-clear':'第三幕通关','heart-victory':'第四幕碎心'}[state.termination];
  const title=`${state.termination==='playing'?'STS':outcome} ${state.character} A${state.observation.game.ascension} | 幕${state.observation.game.act} 层${state.observation.game.floor} | HP ${state.observation.game.hp}/${state.observation.game.maxHp} | 金${state.observation.game.gold} | #${state.revision}`;
  const lines=[fit(title,width),fit(tabs.map((t,i)=>i===model.tab?`[${t}]`:t).join('  '),width),fit(`←→ 切页  Tab 焦点(${model.focus==='actions'?'动作':'内容'})  PgUp/Dn 滚动 ${offset+1}–${Math.min(offset+body,content.length)}/${content.length}`,width),fit('─'.repeat(left)+' ┼ '+`合法动作 ${actions.length}  / 筛选：${model.filter}`,width)];
  for(let i=0;i<body;i++)lines.push(fit(content[offset+i]??'',left)+' │ '+fit(actionRows[start+i]??'',right));
  const detail=current?.details.card as {id:string;upgraded:boolean}|undefined;
  lines.push(fit(model.busy?'正在执行或保存…（不接受重复输入）':model.confirm?`Enter 确认：${current?.label}；Esc 取消`:model.filtering?'输入筛选文字；Enter 完成筛选，Esc 清空':model.multi!==null?`多选模式 已选[${model.multi.join(',')}]；Space 勾选当前候选，Enter 提交；Esc 取消`:detail?describeCard(detail.id,detail.upgraded).text:'Enter 执行当前动作 | / 筛选 | s 保存 | q 保存退出',width));
  lines.push(fit((state.termination==='playing'?'':`终局：${outcome}。`)+(model.message||`内容 ${offset+1}/${content.length}；${state.termination==='playing'?'等待你的选择':`终局：${state.termination}`}`),width));
  lines.push(fit('Enter 执行  / 搜索  m 多选  Space 勾选  s 保存  q 保存退出  ? 帮助',width));
  return '\x1b[H'+lines.join('\r\n')+'\x1b[J';
}
