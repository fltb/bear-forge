// Test fixture acquisition: only legal player actions are sent to the C++ oracle.
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ReferenceClient, type ReferenceState, type RefAction, type RefCard} from './client.ts';
import {revision,root} from './build.ts';

type Catalog={cards:Record<string,{name:string;type:number;weight:number;playOrder:number}>;relics:Record<string,{id:string;bossOrder:number}>};
export type Trace={reference:string;seed:string;character:'IRONCLAD';ascension:20;actions:{kind:'battle'|'game';bits:number}[];
  heartDefeated:boolean;final?:ReferenceState};
export function cardValue(c:RefCard,s:ReferenceState,catalog:Catalog):number {
  const copies=s.game.deck.filter(x=>x.id===c.id).length;
  const has=(id:string)=>s.game.deck.some(x=>x.id===id);
  let weight=catalog.cards[c.id]?.weight ?? 0;
  const values:Record<string,number>={SHRUG_IT_OFF:35,POMMEL_STRIKE:24,BATTLE_TRANCE:55,OFFERING:100,
    DISARM:65,SHOCKWAVE:65,POWER_THROUGH:42,SECOND_WIND:35,DARK_EMBRACE:75,REAPER:80,
    WHIRLWIND:45,INFLAME:60,SPOT_WEAKNESS:65,FLEX:12,BRUTALITY:25,BERSERK:25,FEED:55,
    BODY_SLAM:has('BARRICADE')?85:5,ENTRENCH:has('BARRICADE')?90:10,
    EXHUME:has('REAPER')&&has('CORRUPTION')?200:has('REAPER')?80:10,
    LIMIT_BREAK:has('DEMON_FORM')||has('INFLAME')||has('SPOT_WEAKNESS')?90:12};
  weight=values[c.id]??weight;
  if(gActOne(s) && s.game.deck.filter(x=>catalog.cards[x.id]?.type===0 && !['STRIKE_RED','BASH'].includes(x.id)).length<3) {
    const early:Record<string,number>={CARNAGE:85,IMMOLATE:110,HEMOKINESIS:55,CLEAVE:45,WHIRLWIND:75,
      POMMEL_STRIKE:45,SWORD_BOOMERANG:30,TWIN_STRIKE:30,UPPERCUT:60,IRON_WAVE:25,PERFECTED_STRIKE:30,
      MAYHEM:5,DARK_EMBRACE:20,FEEL_NO_PAIN:25,BRUTALITY:8};
    weight=early[c.id]??weight;
  }
  if(copies>0 && (catalog.cards[c.id]?.type===2 || ['CORRUPTION','DEMON_FORM','BARRICADE'].includes(c.id)))weight*=0.25;
  else if(copies>1)weight*=0.5;
  if(c.upgraded)weight+=8;
  return weight;
}
function gActOne(s:ReferenceState){return s.game.act===1;}
function gameAction(s:ReferenceState,catalog:Catalog):RefAction {
  const g=s.game,legal=s.actions.filter(a=>!a.potion);
  const find=(fn:(a:RefAction)=>boolean)=>legal.find(fn);
  const ranked=(score:(a:RefAction)=>number)=>[...legal].sort((a,b)=>score(b)-score(a))[0]!;
  switch(g.screen) {
    case 'MAP_SCREEN': {
      const nodes=new Map(g.map.nodes.map(n=>[`${n.x},${n.y}`,n]));
      const cache=new Map<string,number>();
      const path=(x:number,y:number):number=>{
        const k=`${x},${y}`;if(cache.has(k))return cache.get(k)!;
        const n=nodes.get(k);if(!n)return 0;
        const values:Record<string,number>={REST:g.hp<g.maxHp*0.7?12:5,ELITE:-5,EVENT:3,MONSTER:1,SHOP:g.gold>=150?5:0,TREASURE:2,BOSS:0,NONE:0};
        const pursueGreen=g.act>=3;
        const burning=!g.keys.green && pursueGreen && x===g.map.burningEliteX && y===g.map.burningEliteY?1000:0;
        const value=(values[n.room]??0)+burning+(n.edges.length?Math.max(...n.edges.map(e=>path(e,y+1))):0);
        cache.set(k,value);return value;
      };
      return ranked(a=>path(a.index!,g.y+1));
    }
    case 'REST_ROOM':
      if(g.act===4 && g.hp<g.maxHp && find(a=>a.index===0))return find(a=>a.index===0)!;
      if(!g.keys.red && g.act>=3 && find(a=>a.index===2))return find(a=>a.index===2)!;
      if(g.hp<g.maxHp*0.62 && find(a=>a.index===0))return find(a=>a.index===0)!;
      if(find(a=>a.index===1))return find(a=>a.index===1)!;
      if(!g.keys.red && find(a=>a.index===2))return find(a=>a.index===2)!;
      return legal[0]!;
    case 'TREASURE_ROOM':return find(a=>a.index===0)??legal[0]!;
    case 'REWARDS': {
      const r=g.rewards;
      if(r.emeraldKey || (r.sapphireKey && !g.keys.blue && g.act>=2))return find(a=>a.type===2)!;
      for(const type of [1,4])if(find(a=>a.type===type))return find(a=>a.type===type)!;
      if(g.potions.some((p:number)=>p===1) && find(a=>a.type===3))return find(a=>a.type===3)!;
      const choices=legal.filter(a=>a.type===0 && a.index2!==5);
      if(choices.length) {
        const best=[...choices].sort((a,b)=>cardValue(r.cards[b.index!][b.index2!],s,catalog)-cardValue(r.cards[a.index!][a.index2!],s,catalog))[0]!;
        const threshold=g.deck.length<16?8:g.deck.length<23?22:40;
        return cardValue(r.cards[best.index!][best.index2!],s,catalog)>=threshold?best:find(a=>a.type===0 && a.index2===5 && a.index===best.index)!;
      }
      return find(a=>a.type===6)!;
    }
    case 'BOSS_RELIC_REWARDS':return ranked(a=>a.index===3?-1000:-(catalog.relics[String(g.bossRelics[a.index!])]?.bossOrder??100));
    case 'CARD_SELECT': {
      const kind=g.select.type;
      return ranked(a=>{
        const c=g.select.cards[a.index!]?.card as RefCard|undefined;if(!c)return -1000;
        if(kind===4 || kind===1 || kind===2) {
          return (catalog.cards[c.id]?.type===3?200:0)+(c.id==='STRIKE_RED'?100:c.id==='DEFEND_RED'?70:0)-cardValue(c,s,catalog);
        }
        if(kind===3) {
          const upgrade:Record<string,number>={APOTHEOSIS:200,CORRUPTION:170,BASH:g.act===1?100:20,OFFERING:120,
            DEMON_FORM:110,DISARM:100,SHOCKWAVE:100,UPPERCUT:100,ARMAMENTS:100,WHIRLWIND:100,TRUE_GRIT:90};
          return upgrade[c.id]??cardValue(c,s,catalog);
        }
        return cardValue(c,s,catalog);
      });
    }
    case 'SHOP_ROOM': {
      const shop=g.shop;
      const cards=legal.filter(a=>a.type===0);
      const good=cards.sort((a,b)=>cardValue(shop.cards[b.index!],s,catalog)-cardValue(shop.cards[a.index!],s,catalog))[0];
      if(good && cardValue(shop.cards[good.index!],s,catalog)>=65)return good;
      const rel=find(a=>a.type===4 && ['DEAD_BRANCH','BAG_OF_PREPARATION','ANCHOR','BAG_OF_MARBLES','VAJRA',
        'ODDLY_SMOOTH_STONE','ORICHALCUM','MUMMIFIED_HAND','CHAMPION_BELT','TOXIC_EGG','TOXIC_EGG_2'].includes(catalog.relics[String(shop.relics[a.index!])]?.id??''));
      if(rel)return rel;
      if(g.act===4 && g.potions.some((p:number)=>p===1)) {
        const p=find(a=>a.type===3 && [14,7,16,6,28].includes(shop.potions[a.index!]));if(p)return p;
      }
      if(find(a=>a.type===5) && (g.act<3 || g.gold-shop.removeCost>=150))return find(a=>a.type===5)!;
      if(good && cardValue(shop.cards[good.index!],s,catalog)>=35)return good;
      return find(a=>a.type===6)!;
    }
    case 'EVENT_SCREEN':
      if(g.neow) {
        const scores:Record<number,number>={0:30,1:45,2:15,3:25,4:30,5:35,6:15,7:60,8:30,9:55,10:45,11:100,12:45,13:85,14:90,15:60,16:50,17:40,18:65};
        return ranked(a=>(scores[g.neow[a.index!]?.bonus]??0)-(g.neow[a.index!]?.drawback===4?15:0));
      }
      if(g.eventName==='Big Fish')return find(a=>a.index===(g.hp<g.maxHp*0.7?0:1))??legal[0]!;
      if(g.eventName==='Golden Idol')return find(a=>a.index===4)??find(a=>a.index===0)??legal[0]!;
      if(g.eventName==='Scrap Ooze')return find(a=>a.index===1)??legal[0]!;
      if(g.eventName==='Ghosts')return find(a=>a.index===0)??legal[0]!;
      if(g.eventName==='The Cleric')return find(a=>a.index===(g.hp<g.maxHp*0.7?0:1))??ranked(a=>a.index!);
      return ranked(a=>a.index!);
    default: throw Error(`No adventure decision for ${g.screen}`);
  }
}

export async function acquire(input:{seed:string;simulations:number;output:string;opening?:number;prefix?:Trace;prefixSteps?:number;maxDecisions?:number;stopFloor?:number;searchSeed?:number}) {
  const ref=await ReferenceClient.create();
  const trace:Trace={reference:revision,seed:input.seed,character:'IRONCLAD',ascension:20,actions:[],heartDefeated:false};
  const save=async()=>{await mkdir(dirname(input.output),{recursive:true});await writeFile(input.output+'.tmp',JSON.stringify(trace)+'\n');await rename(input.output+'.tmp',input.output);};
  try {
    let s=await ref.call({op:'start',seed:input.seed});
    const catalog=await ref.call<Catalog>({op:'catalog'});
    if(input.prefix) {
      if(input.prefix.seed!==input.seed || input.prefix.reference!==revision)throw Error('Incompatible trace prefix');
      for(const a of input.prefix.actions.slice(0,input.prefixSteps)) {
        if(a.kind!==(s.battle?'battle':'game'))throw Error('Prefix boundary mismatch');
        s=await ref.call({op:'advance',bits:a.bits});trace.actions.push(a);
      }
    }
    let solution:number[]=[];let lastEncounter:string|null=null;
    for(let step=0;step<(input.maxDecisions??10000) && s.game.outcome===1;step++) {
      if(input.stopFloor!==undefined && s.game.floor>=input.stopFloor)break;
      const encounter=s.battle?`${s.game.floor}:${s.battle.encounter}`:null;
      if(encounter!==lastEncounter){solution=[];lastEncounter=encounter;}
      let bits:number;
      if(s.battle) {
        if(!solution.length) {
          const boss=s.game.room==='BOSS' || s.game.room==='ELITE';
          let result=await ref.call<{solution:number[];outcomeHp:number;candidates:{bits:number;visits:number;value:number}[]}>(
            {op:'search',simulations:input.simulations*(boss?3:1),seed:input.searchSeed??1});
          if(result.outcomeHp<=0)result=await ref.call<typeof result>({op:'search',simulations:Math.min(1000000,input.simulations*(boss?15:5)),seed:(input.searchSeed??1)+1});
          if(result.outcomeHp>0 && result.solution.length)solution=result.solution;
          else {
            const best=result.candidates.sort((a,b)=>b.visits-a.visits)[0];
            if(!best)throw Error('Battle search returned no legal move');
            solution=[best.bits];
          }
          if(s.battle.turn<=1)process.stdout.write(JSON.stringify({floor:s.game.floor,room:s.game.room,hp:s.battle.player.hp,
            monsters:s.battle.monsters.map(m=>[m.name,m.hp]),searchHp:result.outcomeHp,sequence:solution.length})+'\n');
        }
        bits=solution.shift()!;
      } else {
        const a=trace.actions.length===0 && input.opening!==undefined?s.actions.find(a=>a.index===input.opening):gameAction(s,catalog);
        if(!a)throw Error(`No legal choice on ${s.game.screen}`);
        bits=a.bits;process.stdout.write(JSON.stringify({floor:s.game.floor,screen:s.game.screen,event:s.game.eventName,hp:s.game.hp,keys:s.game.keys,action:a.description||{type:a.type,index:a.index,index2:a.index2},
          deck:s.game.deck.map(c=>c.id+(c.upgraded?'+':''))})+'\n');
      }
      const action={kind:s.battle?'battle' as const:'game' as const,bits};
      s=await ref.call({op:'advance',bits});trace.actions.push(action);
      trace.heartDefeated=s.heartDefeated;
      await save();
    }
    trace.final=s;await save();
    process.stdout.write(JSON.stringify({seed:input.seed,decisions:trace.actions.length,heartDefeated:trace.heartDefeated,act:s.game.act,floor:s.game.floor,hp:s.battle?.player.hp??s.game.hp,outcome:s.game.outcome,output:input.output})+'\n');
    return trace;
  }finally{await ref.close();}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);const option=(name:string,fallback:string)=>{const i=args.indexOf('--'+name);return i<0?fallback:args[i+1]!;};
  const seed=option('seed','1'),prefix=option('prefix','');
  const cwd=process.env.INIT_CWD??process.cwd();
  await acquire({seed,simulations:Number(option('simulations','10000')),output:resolve(cwd,option('output',resolve(root,`data/sts-reference/${seed}.json`))),
    ...(args.includes('--opening')?{opening:Number(option('opening','0'))}:{}),
    ...(prefix?{prefix:JSON.parse(await readFile(resolve(cwd,prefix),'utf8')) as Trace,prefixSteps:Number(option('prefix-steps','100000'))}:{}),
    ...(args.includes('--stop-floor')?{stopFloor:Number(option('stop-floor','1'))}:{})});
}
