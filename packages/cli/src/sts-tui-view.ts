import {describeCard,formatDecision,presentDecision} from '@bear-forge/sts';
import type {Action} from '@bear-forge/sts';
import type {EventBatch} from '../../../examples/sts/src/simulator.types.ts';

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
  if(tab===2)return [`当前 (${g.x},${g.y})；连线列出下一行 x 坐标；? 为未知房间`,...g.map.nodes.filter(n=>n.room!=='NONE').sort((a,b)=>a.y-b.y||a.x-b.x).map(n=>`${n.x===g.x&&n.y===g.y?'●':' '} (${n.x},${n.y}) ${n.room}${n.x===g.map.burningEliteX&&n.y===g.map.burningEliteY?' [燃烧精英 / 绿钥匙]':''} → ${n.edges.join(', ')}`)];
  if(tab===1){
    const lines=[`永久牌组 ${g.deck.length} 张`,...g.deck.map(c=>`${describeCard(c.id,c.upgraded).name}${c.upgraded?'+':''}：${describeCard(c.id,c.upgraded).text}`)];
    if(b)for(const [name,cards]of [['手牌',b.hand],['弃牌',b.discard],['消耗',b.exhaust],['抽牌堆（Frozen Eye 公开顺序）',b.draw??[]]] as const){lines.push(`${name} ${cards.length} 张`,...cards.map(c=>`${describeCard(c.id,c.upgraded).name}${c.upgraded?'+':''}：${describeCard(c.id,c.upgraded).text}`));}
    if(b&&!b.draw)lines.push(`抽牌堆 ${b.drawCount} 张：顺序未揭示`);
    return lines;
  }
  if(tab===5)return ['当前操作与目标请见右侧光标；卡牌、遗物和药水文案来自原定义。',...p.rules.cards.map(c=>`${c.name}${c.upgraded?'+':''}：${c.text}`)];
  if(tab===4)return [...p.rules.relics.map(r=>`${r.id}：${r.text}`),...p.rules.potions.map(r=>`${r.id}：${r.text}`),...p.rules.statuses.map(s=>`${s.name}：${s.text}`),...Object.entries(p.rules.mechanics).map(([name,text])=>`${name}：${text}`)];
  // Reuse authoritative presentation; strip the old numeric-input footer.
  const formatted=formatDecision(o,{...p,actions:[]}).split('\n');
  return formatted.slice(0,-3).filter(Boolean);
}

export type TuiModel={batch:EventBatch;tab:number;scroll:number;selected:number;filter:string;filtering:boolean;message:string;busy:boolean;log:string[];focus:'actions'|'content';confirm:boolean;multi:number[]|null};
export function renderTui(model:TuiModel,columns:number,rows:number){
  const width=Math.max(20,columns-1),height=Math.max(8,rows),state=model.batch.state;
  if(columns<60||rows<16)return '\x1b[H'+['STS TUI — 窗口过小',`当前 ${columns} × ${rows}，请调整为至少 60 × 16。`,'已暂停接收动作；q 保存退出。'].map(s=>fit(s,width)).join('\r\n')+'\x1b[J';
  const p=decisionPresentation(model.batch),actions=p.actions.filter(a=>a.label.toLowerCase().includes(model.filter.toLowerCase()));
  const left=Math.floor((width-3)*.52),right=width-left-3,body=height-7;
  const current=model.multi===null?actions[model.selected]:undefined;
  const selectedCard=current?.details.card as {id:string;upgraded:boolean}|undefined;
  const extra=model.tab===5&&current?['当前操作：'+current.label,...(selectedCard?[describeCard(selectedCard.id,selectedCard.upgraded).text]:[]),'']:[];
  const content=[...extra,...contentLines(model.batch,model.tab,model.log,p)].flatMap(line=>wrap(line,left));
  const maxScroll=Math.max(0,content.length-body),offset=Math.min(model.scroll,maxScroll);
  model.scroll=offset;
  const actionRows:string[]=[];let selectedLine=0;
  const choices=model.multi===null?actions.map(a=>a.label):(model.batch.state.observation.battle?.select?.candidates??[]).map(c=>`${model.multi!.includes(c.index)?'[x]':'[ ]'} ${describeCard(c.card.id,c.card.upgraded).name} — ${describeCard(c.card.id,c.card.upgraded).text}`);
  for(const [index,label]of choices.entries()){
    if(index===model.selected)selectedLine=actionRows.length;
    const text=(index===model.selected?'▶ ':'  ')+label;
    actionRows.push(...wrap(text,right));
  }
  const start=Math.max(0,selectedLine-Math.floor(body/3));
  const outcome={playing:'进行中',death:'死亡', 'act3-clear':'第三幕通关','heart-victory':'第四幕碎心'}[state.termination];
  const title=`${state.termination==='playing'?'STS':outcome} ${state.character} A${state.observation.game.ascension} | 幕${state.observation.game.act} 层${state.observation.game.floor} | HP ${state.observation.game.hp}/${state.observation.game.maxHp} | 金${state.observation.game.gold} | #${state.revision}`;
  const lines=[fit(title,width),fit(tabs.map((t,i)=>i===model.tab?`[${t}]`:t).join('  '),width),fit(`←→ 切页  Tab 切焦点(${model.focus==='actions'?'动作':'内容'})  ↑↓ 选择/滚动  PgUp/Dn 内容滚动`,width),fit('─'.repeat(left)+' ┼ '+`合法动作 ${actions.length}  / 筛选：${model.filter}`,width)];
  for(let i=0;i<body;i++)lines.push(fit(content[offset+i]??'',left)+' │ '+fit(actionRows[start+i]??'',right));
  const detail=current?.details.card as {id:string;upgraded:boolean}|undefined;
  lines.push(fit(model.busy?'正在执行或保存…（不接受重复输入）':model.confirm?`Enter 确认：${current?.label}；Esc 取消`:model.filtering?'输入筛选文字；Enter 完成筛选，Esc 清空':model.multi!==null?`多选模式 已选[${model.multi.join(',')}]；Space 勾选当前候选，Enter 提交；Esc 取消`:detail?describeCard(detail.id,detail.upgraded).text:'Enter 执行当前动作 | / 筛选 | s 保存 | q 保存退出',width));
  lines.push(fit((state.termination==='playing'?'':`终局：${outcome}。`)+(model.message||`内容 ${offset+1}/${content.length}；${state.termination==='playing'?'等待你的选择':`终局：${state.termination}`}`),width));
  lines.push(fit('Enter 执行  / 搜索  m 多选  Space 勾选  s 保存  q 保存退出  ? 帮助',width));
  return '\x1b[H'+lines.join('\r\n')+'\x1b[J';
}
