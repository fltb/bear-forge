import type {EventBatch} from '../simulator.types.ts';
import {encounterId} from '../identifiers.ts';
import type {decisionPresentation} from './sts-tui-view.ts';
type Presentation=ReturnType<typeof decisionPresentation>;
const rooms:Record<string,[string,string]>={MONSTER:['M','战斗'],ELITE:['E','精英'],REST:['R','营火'],SHOP:['$','商店'],EVENT:['?','未知房间'],TREASURE:['T','宝箱'],BOSS:['B','Boss']};
export const roomName=(room:string)=>rooms[room]?.[1]??room;
const column=(x:number)=>String.fromCharCode(65+x);
function nextNodes(batch:EventBatch,p:Presentation){
  const g=batch.state.observation.game,legal=p.actions.filter(a=>a.kind==='travel').map(a=>a.details.x as number);
  const next=legal.length?legal:g.y<0?g.map.nodes.filter(n=>n.y===0&&n.room!=='NONE').map(n=>n.x):g.map.nodes.find(n=>n.x===g.x&&n.y===g.y)?.edges??[];
  return g.map.nodes.filter(n=>n.y===g.y+1&&next.includes(n.x)&&n.room!=='NONE');
}
export function routeDetails(batch:EventBatch,x:number,y:number){
  const g=batch.state.observation.game,node=g.map.nodes.find(n=>n.x===x&&n.y===y);
  if(!node)return ['下一站：Boss'];
  const burning=x===g.map.burningEliteX&&y===g.map.burningEliteY;
  const exits=g.map.nodes.filter(n=>n.y===y+1&&node.edges.includes(n.x)&&n.room!=='NONE');
  return [`第 ${y+1} 层 · ${column(x)} · ${burning?'燃烧精英':roomName(node.room)}`,
    ...(burning?['高难度精英 · 可获得绿钥匙']:[]),
    `之后可走：${y>=14?'Boss':exits.map(n=>`${column(n.x)} ${n.x===g.map.burningEliteX&&n.y===g.map.burningEliteY?'燃烧精英':roomName(n.room)}`).join(' / ')||'无'}`,
    ...(node.room==='EVENT'?['? 房间可能转为战斗、商店或事件']:[])];
}
/** Follow the published edges only; room types and map symbols never predict events. */
export function routeMap(batch:EventBatch,p:Presentation){
  const g=batch.state.observation.game,immediate=nextNodes(batch,p),reachable=new Set<string>();
  if(g.y>=0)reachable.add(`${g.x},${g.y}`);
  for(const n of immediate)reachable.add(`${n.x},${n.y}`);
  for(let y=Math.max(0,g.y+1);y<15;y++)for(const n of g.map.nodes.filter(n=>n.y===y&&reachable.has(`${n.x},${n.y}`)))for(const x of n.edges)reachable.add(`${x},${y+1}`);
  const lines=['向下推进 ↓ · 仅显示可达路线',g.y<0?'@ 起点：选择第一场战斗':`@ 当前：第 ${g.y+1} 层 ${column(g.x)}`,
    'M 战斗 · E 精英 · ! 燃烧精英','R 营火 · $ 商店 · T 宝箱','? 未知 · @ 当前 · PgDn 看后续','','       A  B  C  D  E  F  G'];
  for(let y=Math.max(0,g.y);y<=14;y++){
    const nodes=g.map.nodes.filter(n=>n.y===y&&n.room!=='NONE'&&reachable.has(`${n.x},${y}`));
    if(!nodes.length)continue;
    const cells=Array<string>(21).fill(' ');
    for(const n of nodes)cells[n.x*3+1]=n.x===g.x&&n.y===g.y?'@':n.x===g.map.burningEliteX&&n.y===g.map.burningEliteY?'!':rooms[n.room]?.[0]??'?';
    lines.push(`${y===g.y+1?'›':' '} ${String(y+1).padStart(2)}  ${cells.join('')}`);
    if(y>=14)continue;
    for(let step=1;step<=2;step++){
      const edge=Array<string>(21).fill(' ');
      for(const n of nodes)for(const x of n.edges){
        const end=g.map.nodes.find(v=>v.x===x&&v.y===y+1&&v.room!=='NONE');if(!end)continue;
        const start=n.x*3+1,to=x*3+1,at=Math.round(start+(to-start)*step/3),symbol=to===start?'│':to>start?'╲':'╱';
        edge[at]=edge[at]!==' '&&edge[at]!==symbol?'┼':symbol;
      }
      lines.push('      '+edge.join(''));
    }
  }
  lines.push('','↓ Boss：'+(Object.entries(encounterId).find(([,id])=>id===g.boss)?.[0]??g.boss),'','› 下一层：在右侧选择目的地');
  return lines;
}
