// Literal algorithm port of sts_lightspeed 7476a819 src/game/Map.cpp.
import {randomState,randomInt,nextInt,type RandomState} from './rng.ts';
import type {rules} from './rules/execution.ts';
import type {Room,MapNode,SpireMap,MapConstruction,MapDraw} from './map.types.ts';
export type MapRandom={int(start:number,end:number):number;index(size:number):number};
const roomIds:Record<Room,number>={SHOP:0,REST:1,EVENT:2,ELITE:3,MONSTER:4,TREASURE:5,BOSS:6,BOSS_TREASURE:7,NONE:8,INVALID:9};
const masks=Array.from({length:7},(_,i)=>0x0101010101010101n<<BigInt(i));
export function nodeAt<N extends rules.Borrowed<MapNode>>(map:{readonly nodes:readonly N[]},x:number,y:number):N {
  if(x<0||x>6||y<0||y>14)throw Error('Map position out of bounds');return map.nodes[y*7+x]!;
}
function emptyMap():SpireMap {
  return {nodes:Array.from({length:105},(_,i)=>({x:i%7,y:Math.floor(i/7),room:'NONE',edges:[],parents:[]})),
    burningEliteX:-1,burningEliteY:-1,burningEliteBuff:-1};
}
function addEdge(node:MapNode,x:number) {
  if(node.edges.includes(x))return;const i=node.edges.findIndex(v=>v>x);
  if(i<0)node.edges.push(x);else node.edges.splice(i,0,x);
}
function commonAncestor(map:SpireMap,x1:number,x2:number,y:number):number {
  if(y<0)return -1;
  // Preserve the reference's x1 < y comparison; changing it to x1 < x2 changes maps.
  const left=nodeAt(map,x1<y?x1:x2,y),right=nodeAt(map,x1<y?x2:x1,y);
  if(!left.parents.length||!right.parents.length)return -1;
  const x=Math.max(...left.parents);return x===Math.min(...right.parents)?x:-1;
}
function removeDuplicateStarts(map:SpireMap) {
  const visited=new Set<number>();
  for(let x=0;x<7;x++){
    const node=nodeAt(map,x,0);
    for(let i=node.edges.length-1;i>=0;i--){
      const dest=node.edges[i]!;
      if(visited.has(dest)){
        const child=nodeAt(map,dest,1);child.parents=child.parents.filter(p=>p!==x);node.edges.splice(i,1);
      }else visited.add(dest);
    }
  }
}
type Constructor={rooms:Room[];offset:number;row:bigint;previous:bigint;siblings:bigint[];nextSiblings:bigint[];parents:bigint[];nextParents:bigint[]};
function propagate(node:MapNode,data:Constructor) {
  if(node.edges.length===1){data.nextParents[node.edges[0]!]!|=0xffn<<BigInt(node.x*8);return;}
  let siblings=0n;
  for(const edge of node.edges){
    siblings|=0xffn<<BigInt(edge*8);data.nextSiblings[edge]!|=siblings;data.nextParents[edge]!|=0xffn<<BigInt(node.x*8);
  }
}
function assignNode(node:MapNode,data:Constructor) {
  const tried=new Set<Room>();
  for(let i=data.offset;i<data.rooms.length;i++) {
    const room=data.rooms[i]!;if(tried.has(room))continue;tried.add(room);
    if(room==='ELITE'&&node.y<=4)continue;
    if(room==='REST'&&(node.y<=4||node.y>=13))continue;
    const sibling=(data.row&data.siblings[node.x]!&masks[roomIds[room]]!)!==0n;
    const parent=(data.previous&data.parents[node.x]!&masks[roomIds[room]]!)!==0n;
    if(sibling || (room!=='EVENT'&&room!=='MONSTER'&&parent))continue;
    node.room=room;data.row|=1n<<BigInt(roomIds[room]+node.x*8);
    for(let j=i;j>data.offset;j--)data.rooms[j]=data.rooms[j-1]!;data.offset++;return;
  }
  node.room='MONSTER';
}
function prepareRooms(map:SpireMap,ascension:number) {
  let total=0,unassigned=0;
  for(const node of map.nodes){
    if(!node.edges.length)continue;
    if(node.y===0){node.room='MONSTER';total++;}
    else if(node.y===8){node.room='TREASURE';total++;}
    else if(node.y===14){node.room='REST';total++;}
    else if(node.y===13)unassigned++;
    else {unassigned++;total++;}
  }
  const f=Math.fround,rooms:Room[]=[];
  const chances:[Room,number][]=[['SHOP',f(0.05)],['REST',f(0.12)],['TREASURE',0],
    ['ELITE',ascension>0?f(f(0.08)*f(1.6)):f(0.08)],['EVENT',f(0.22)]];
  for(const [room,chance]of chances)for(let i=0,count=Math.round(f(total*chance));i<count;i++)rooms.push(room);
  if(rooms.length>=total)throw Error('Invalid reference room counts');
  while(rooms.length<unassigned)rooms.push('MONSTER');
  return{rooms,unassigned};
}
function assignRooms(map:SpireMap,rooms:Room[]) {
  const zeros=()=>Array<bigint>(7).fill(0n);
  const data:Constructor={rooms,offset:0,row:0n,previous:0n,siblings:zeros(),nextSiblings:zeros(),parents:zeros(),nextParents:zeros()};
  for(let y=0;y<14;y++){
    for(let x=0;x<7;x++){
      const node=nodeAt(map,x,y);if(!node.edges.length)continue;
      if(y===0||y===8)propagate(node,data);
      else if(y===7||y===13){assignNode(node,data);data.row|=1n<<BigInt(roomIds[node.room]+x*8);}
      else{assignNode(node,data);propagate(node,data);}
    }
    data.previous=data.row;data.row=0n;
    data.siblings=data.nextSiblings;data.nextSiblings=zeros();data.parents=data.nextParents;data.nextParents=zeros();
  }
}
export function generateMap(seed:bigint,ascension:number,act:number,setBurning:boolean):SpireMap {
  const rng=mapRandomState(seed,act);
  return generateMapWithRandom(ascension,act,setBurning,{int:(start,end)=>randomInt(rng,start,end),index:size=>nextInt(rng,size)});
}
export const mapRandomState=(seed:bigint,act:number):RandomState=>randomState(seed+BigInt(act===1?1:act*(100*(act-1))));
export const drawMapRandom=(random:RandomState,draw:MapDraw):number=>draw.counted?randomInt(random,draw.start,draw.end):nextInt(random,draw.end+1);
/** The one map algorithm. Only the random source differs in probability mode. */
export function generateMapWithRandom(ascension:number,act:number,setBurning:boolean,rng:MapRandom):SpireMap {
  let work=beginMapConstruction(ascension,act,setBurning);
  for(let draw=mapDraw(work);draw!==null;draw=mapDraw(work)){
    work=advanceMapConstruction(work,draw.counted?rng.int(draw.start,draw.end):rng.index(draw.end+1));
  }
  return work.map;
}

/** Both the real driver and the probability driver use this construction.
 * All topology, room eligibility, adjustments and ordering live here once. */
export function beginMapConstruction(ascension:number,act:number,burning:boolean):MapConstruction {
  const work:MapConstruction={map:emptyMap(),ascension,burning,phase:'start',path:0,first:-1,x:0,y:0,next:0,destination:0,parent:0,rooms:[],shuffle:0};
  if(act===4){
    const rooms:Room[]=['REST','SHOP','ELITE','BOSS'];
    for(let y=0;y<4;y++){const n=nodeAt(work.map,3,y);n.room=rooms[y]!;if(y<3)addEdge(n,3);if(y>0)n.parents.push(3);}
    work.phase='done';return work;
  }
  if(![1,2,3].includes(act))throw Error('Invalid act');
  return work;
}
export function mapDraw(work:rules.Borrowed<MapConstruction>):MapDraw|null {
  switch(work.phase){
    case 'done':return null;
    case 'start':return{start:0,end:6,counted:true};
    case 'step':return{start:work.x===0?0:-1,end:work.x===6?0:1,counted:true};
    case 'adjust':return{start:work.next>=work.x?-1:0,end:work.next>work.x?0:1,counted:true};
    case 'shuffle':return{start:0,end:work.shuffle-1,counted:false};
    case 'elite':return{start:0,end:work.map.nodes.filter(n=>n.room==='ELITE').length-1,counted:true};
    case 'buff':return{start:0,end:3,counted:true};
  }
}
function finishRooms(work:MapConstruction){assignRooms(work.map,work.rooms);work.phase=work.burning?'elite':'done';}
function continuePath(work:MapConstruction){
  const {map,x,y}=work;
  // Retain the originally selected destination, as the source does, across
  // all adjustments. Its parent cursor is part of the saved current state.
  const destination=nodeAt(map,work.destination,y+1);
  while(work.parent<destination.parents.length){
    const parent=destination.parents[work.parent++]!;
    if(parent!==x&&commonAncestor(map,parent,x,y)!==-1){work.phase='adjust';return;}
  }
  if(x!==0){const neighbor=nodeAt(map,x-1,y);if(neighbor.edges.length){const e=neighbor.edges.at(-1)!;if(e>work.next)work.next=e;}}
  if(x<6){const neighbor=nodeAt(map,x+1,y);if(neighbor.edges.length){const e=neighbor.edges[0]!;if(e<work.next)work.next=e;}}
  addEdge(nodeAt(map,x,y),work.next);nodeAt(map,work.next,y+1).parents.push(x);work.x=work.next;work.y++;
  if(work.y<14){work.phase='step';return;}
  addEdge(nodeAt(map,work.x,14),3);work.path++;
  if(work.path<6){work.phase='start';return;}
  removeDuplicateStarts(map);const prepared=prepareRooms(map,work.ascension);work.rooms=prepared.rooms;work.shuffle=prepared.unassigned;
  if(work.shuffle>1)work.phase='shuffle';else finishRooms(work);
}
/** Consume exactly this pending draw. The caller's current remains untouched;
 * all mutable construction data in the result belongs to the successor. */
export function advanceMapConstruction(current:rules.Borrowed<MapConstruction>,value:number):MapConstruction {
  const draw=mapDraw(current);if(!draw||!Number.isInteger(value)||value<draw.start||value>draw.end)throw Error('Invalid map random result');
  const work:MapConstruction={...current,map:{...current.map,nodes:current.map.nodes.map(node=>({...node,edges:[...node.edges],parents:[...node.parents]}))},rooms:[...current.rooms]};
  switch(work.phase){
    case 'start':
      // The original second path rejects the first path's starting column.
      // Rejected draws retain this exact current and request another draw.
      if(work.path===1&&value===work.first)return work;
      if(work.path===0)work.first=value;work.x=value;work.y=0;work.phase='step';break;
    case 'step':work.next=work.x+value;work.destination=work.next;work.parent=0;continuePath(work);break;
    case 'adjust':{
      const prior=work.next;work.next=work.x+value;
      if(prior>work.x){if(work.next<0)work.next=work.x;}
      else if(prior===work.x){if(work.next>6)work.next=work.x-1;else if(work.next<0)work.next=work.x+1;}
      else if(work.next>6)work.next=work.x;
      continuePath(work);break;
    }
    case 'shuffle':{
      const last=work.shuffle-1;[work.rooms[last],work.rooms[value]]=[work.rooms[value]!,work.rooms[last]!];work.shuffle--;
      if(work.shuffle<=1)finishRooms(work);break;
    }
    case 'elite':{
      const elite=work.map.nodes.filter(n=>n.room==='ELITE')[value]!;work.map.burningEliteX=elite.x;work.map.burningEliteY=elite.y;work.phase='buff';break;
    }
    case 'buff':work.map.burningEliteBuff=value;work.phase='done';break;
  }
  return work;
}
