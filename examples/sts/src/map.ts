// Literal algorithm port of sts_lightspeed 7476a819 src/game/Map.cpp.
import {randomState,randomInt,nextInt} from './rng.ts';
import type {rules} from './rules/execution.ts';
import type {Room,MapNode,SpireMap} from './map.types.ts';
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
function choosePath(map:SpireMap,rng:MapRandom,x:number,y:number):number {
  let next=x+rng.int(x===0?0:-1,x===6?0:1);
  // C++ retains a reference to the originally selected destination throughout this loop.
  const destination=nodeAt(map,next,y+1);
  for(const parent of destination.parents) {
    if(parent===x||commonAncestor(map,parent,x,y)===-1)continue;
    if(next>x){next=x+rng.int(-1,0);if(next<0)next=x;}
    else if(next===x){next=x+rng.int(-1,1);if(next>6)next=x-1;else if(next<0)next=x+1;}
    else{next=x+rng.int(0,1);if(next>6)next=x;}
  }
  if(x!==0){const neighbor=nodeAt(map,x-1,y);if(neighbor.edges.length){const e=neighbor.edges.at(-1)!;if(e>next)next=e;}}
  if(x<6){const neighbor=nodeAt(map,x+1,y);if(neighbor.edges.length){const e=neighbor.edges[0]!;if(e<next)next=e;}}
  return next;
}
function createPath(map:SpireMap,rng:MapRandom,start:number) {
  let x=start;
  for(let y=0;y<14;y++){
    const next=choosePath(map,rng,x,y);addEdge(nodeAt(map,x,y),next);nodeAt(map,next,y+1).parents.push(x);x=next;
  }
  addEdge(nodeAt(map,x,14),3);
}
function createPaths(map:SpireMap,rng:MapRandom) {
  const first=rng.int(0,6);createPath(map,rng,first);
  for(let i=1;i<6;i++){
    let start=rng.int(0,6);while(start===first&&i===1)start=rng.int(0,6);createPath(map,rng,start);
  }
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
function assignRooms(map:SpireMap,rng:MapRandom,ascension:number) {
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
  for(let i=unassigned;i>1;i--){const j=rng.index(i);[rooms[i-1],rooms[j]]=[rooms[j]!,rooms[i-1]!];}
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
  const rng=randomState(seed+BigInt(act===1?1:act*(100*(act-1))));
  return generateMapWithRandom(ascension,act,setBurning,{int:(start,end)=>randomInt(rng,start,end),index:size=>nextInt(rng,size)});
}
/** The one map algorithm. Only the random source differs in probability mode. */
export function generateMapWithRandom(ascension:number,act:number,setBurning:boolean,rng:MapRandom):SpireMap {
  if(act===4){
    const map=emptyMap(),rooms:Room[]=['REST','SHOP','ELITE','BOSS'];
    for(let y=0;y<4;y++){const n=nodeAt(map,3,y);n.room=rooms[y]!;if(y<3)addEdge(n,3);if(y>0)n.parents.push(3);}
    return map;
  }
  if(![1,2,3].includes(act))throw Error('Invalid act');
  const map=emptyMap();
  createPaths(map,rng);assignRooms(map,rng,ascension);
  if(setBurning){
    const elites=map.nodes.filter(n=>n.room==='ELITE');const elite=elites[rng.int(0,elites.length-1)]!;
    map.burningEliteX=elite.x;map.burningEliteY=elite.y;map.burningEliteBuff=rng.int(0,3);
  }
  return map;
}
