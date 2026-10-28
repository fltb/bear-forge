import type {Observation} from '../game.schemas.ts';
import type {RandomCursor} from '@bear-forge/policies';
import {searchEntropyWord} from '@bear-forge/policies/search/entropy';
import {describeAction,describeCard} from '../presentation.ts';
import {cards} from '../cards.ts';
import {PS} from '../combat-identifiers.ts';
import {potionId,relicId} from '../identifiers.ts';
import {publicKey,type PublicDecision} from './information.ts';

/** Choose one representative for visibly identical starter-card plays.
 * This is a local game heuristic, NOT full-Context equivalence: it ignores
 * physical card identity but never changes a retained action's chance law. */
export function combatExclusions(decision:PublicDecision):{key:string;reason:string}[]{
  const seen=new Set<string>(),excluded:{key:string;reason:string}[]=[];
  for(const action of decision.actions){
    const described=describeAction(decision.observation,action.bits);
    if(described.kind!=='play-card')continue;
    const card=decision.observation.battle?.hand[Number(described.details.hand)];
    if(!card||!['STRIKE_RED','DEFEND_RED'].includes(card.id))continue;
    const {uniqueId,...visible}=card,key=publicKey({card:visible,target:described.details.target,
      cost:decision.observation.battle?.costs?.[String(action.bits)]??card.costForTurn});
    if(seen.has(key))excluded.push({key:String(action.bits),reason:'duplicate-public-basic-card'});
    else seen.add(key);
  }
  return excluded;
}

/** Public ordering preferences: use setup while energy remains, focus wounded
 * targets, and exhaust clutter. Also used only after exact local value/risk
 * ties in selection. No candidate or chance support is removed. */
export function combatTiePreferences(decision:PublicDecision):Record<string,number>{
  const battle=decision.observation.battle;
  if(!battle)return{};
  const selection=battle.select,preferences:Record<string,number>={};
  if(!selection){
    const exposed=Math.max(0,(battle.intents??[]).reduce((sum,intent)=>sum+intent.attackDamage*intent.hits,0)-battle.player.block);
    const urgency=Math.min(4,exposed/Math.max(1,battle.player.hp));
    for(const action of decision.actions){
      const described=describeAction(decision.observation,action.bits);
      if(described.kind!=='play-card')continue;
      const hand=Number(described.details.hand),card=battle.hand[hand]!;
      const cost=battle.costs?.[String(action.bits)]??card.costForTurn;
      const remaining=Math.max(0,battle.player.energy-Math.max(0,cost));
      // Strategic roles do not execute draw, damage, vulnerability or costs.
      // Original legal actions/costs and current public resources supply the
      // context: drawing after spending every energy earns no setup priority.
      const roles=cardRoles(card.id);
      let preference=roles.flow*Math.min(3,remaining)+3*roles.defense*urgency;
      // Immediate strength setup deserves the same early exploration as
      // vulnerability. This is ordering only; original execution determines
      // whether setup actually improves the subsequent public board.
      if(['BASH','THUNDERCLAP','UPPERCUT','SHOCKWAVE','INFLAME','FLEX'].includes(card.id)&&battle.hand.some((other,index)=>
        index!==hand&&cards[other.id as keyof typeof cards].type===0&&other.costForTurn>=0&&other.costForTurn<=remaining))preference+=2;
      if(cards[card.id as keyof typeof cards].type===0&&described.details.target!==null){
        const target=battle.monsters.find(monster=>monster.index===described.details.target)!;
        preference+=1/(1+target.hp);
      }
      if(preference>0)preferences[String(action.bits)]=preference;
    }
    return preferences;
  }
  if(selection.task!=='EXHAUST_ONE')return{};
  for(const action of decision.actions){
    const described=describeAction(decision.observation,action.bits);
    if(described.kind!=='select-cards')continue;
    const indices=described.details.indices as number[];
    if(indices.length!==1)continue;
    const card=selection.candidates!.find(candidate=>candidate.index===indices[0])!.card;
    const type=describeCard(card.id,card.upgraded).type;
    if(type===3||type===4)preferences[String(action.bits)]=1;
  }
  return preferences;
}

// Dimensionless strategic preferences, never damage/block amounts or executable rules.
type Roles={attack:number;defense:number;flow:number;scaling:number;exhaust:number;area:number};
const empty=():Roles=>({attack:0,defense:0,flow:0,scaling:0,exhaust:0,area:0});
const groups:{role:keyof Roles;names:string;weight:number}[]=[
  {role:'attack',names:'STRIKE_RED',weight:.5},
  {role:'attack',names:'BASH ANGER IRON_WAVE POMMEL_STRIKE THUNDERCLAP',weight:1},
  {role:'attack',names:'CARNAGE HEMOKINESIS PERFECTED_STRIKE UPPERCUT WILD_STRIKE BLUDGEON SEVER_SOUL HEAVY_BLADE BLOOD_FOR_BLOOD IMMOLATE FIEND_FIRE WHIRLWIND SEARING_BLOW',weight:2},
  {role:'attack',names:'SWORD_BOOMERANG TWIN_STRIKE HEADBUTT BODY_SLAM PUMMEL RAMPAGE',weight:1.3},
  {role:'defense',names:'DEFEND_RED',weight:.5},
  {role:'defense',names:'SHRUG_IT_OFF TRUE_GRIT IRON_WAVE FLAME_BARRIER SECOND_WIND GHOSTLY_ARMOR POWER_THROUGH',weight:1.8},
  {role:'defense',names:'IMPERVIOUS DISARM SHOCKWAVE',weight:3},
  {role:'flow',names:'POMMEL_STRIKE SHRUG_IT_OFF HEADBUTT',weight:.7},
  {role:'flow',names:'BATTLE_TRANCE OFFERING BURNING_PACT DARK_EMBRACE EVOLVE MASTER_OF_STRATEGY',weight:2.5},
  {role:'flow',names:'BLOODLETTING SEEING_RED SENTINEL CORRUPTION',weight:1.5},
  {role:'scaling',names:'INFLAME SPOT_WEAKNESS DEMON_FORM LIMIT_BREAK BARRICADE ENTRENCH FEEL_NO_PAIN CORRUPTION DARK_EMBRACE',weight:2},
  {role:'scaling',names:'RUPTURE RAMPAGE SEARING_BLOW',weight:.8},
  {role:'exhaust',names:'TRUE_GRIT SECOND_WIND BURNING_PACT FIEND_FIRE CORRUPTION',weight:2},
  {role:'area',names:'CLEAVE THUNDERCLAP',weight:1},
  {role:'area',names:'WHIRLWIND IMMOLATE REAPER',weight:3},
];
const roleBook=new Map<string,Roles>();
for(const group of groups)for(const id of group.names.split(' ')){const r=roleBook.get(id)??empty();r[group.role]+=group.weight;roleBook.set(id,r);}
// Named weights express strategy only. Every original attack still contributes
// baseline output even when it has only an area/scaling role or no named entry.
function cardRoles(id:string):Roles{
  const role={...(roleBook.get(id)??empty())};
  if(describeCard(id).type===0&&role.attack===0)role.attack=1;
  return role;
}
export function deckProfile(o:Observation):Roles{
  const result=empty();for(const c of o.game.deck){const role=cardRoles(c.id);for(const k of Object.keys(result) as (keyof Roles)[])result[k]+=role[k]*(c.upgraded?1.15:1);}
  return result;
}
export function cardPreference(o:Observation,c:{id:string;upgraded:boolean}):number{
  const d=describeCard(c.id,c.upgraded),profile=deckProfile(o),has=(id:string)=>o.game.deck.some(c=>c.id===id),copies=o.game.deck.filter(x=>x.id===c.id).length;
  if(d.type===3||d.type===4)return -12;
  const role=cardRoles(c.id),targets:Roles={attack:o.game.act===1?6:8,defense:7+o.game.act*2,flow:4+o.game.act,scaling:o.game.act*2,exhaust:2,area:2};
  let score=-.5;
  for(const k of Object.keys(profile) as (keyof Roles)[]){
    const added=role[k]*(c.upgraded?1.15:1);
    // Marginal construction utility, phi(x)=1.35*x-x*x/(2*target).
    // Count the candidate's full contribution. Removing the old positive
    // floor lets surplus roles cost deck space instead of rewarding every
    // additional attack after the deck already has enough damage.
    score+=added*(1.35-(profile[k]+added/2)/targets[k])*(k==='exhaust'&&!has('FEEL_NO_PAIN')&&!has('DARK_EMBRACE')?.1:1);
  }
  const addedAttacks=o.game.deck.filter(c=>describeCard(c.id,c.upgraded).type===0&&describeCard(c.id,c.upgraded).variant.cost>=0&&!['STRIKE_RED','BASH'].includes(c.id)).length;
  if(o.game.act===1&&addedAttacks<3)score+=role.attack*1.8;
  if(c.id==='ANGER'&&addedAttacks<3)score+=1.5;
  if(d.type===1&&role.defense===0&&role.flow===0)score+=.25;
  if(['STRIKE_RED','DEFEND_RED'].includes(c.id))score-=3;
  if(['OFFERING','SHOCKWAVE','DISARM','IMPERVIOUS','BATTLE_TRANCE','IMMOLATE','REAPER','FEED'].includes(c.id))score+=2;
  if(c.id==='FEEL_NO_PAIN'||c.id==='DARK_EMBRACE')score+=profile.exhaust*.4;
  if(c.id==='CORRUPTION')score+=o.game.deck.filter(x=>describeCard(x.id,x.upgraded).type===1).length*.35+(has('FEEL_NO_PAIN')?2:0)+(has('DARK_EMBRACE')?2:0);
  if(role.exhaust)score+=(has('FEEL_NO_PAIN')?1:0)+(has('DARK_EMBRACE')?1:0);
  if(['HEAVY_BLADE','SWORD_BOOMERANG','PUMMEL','REAPER','LIMIT_BREAK'].includes(c.id))score+=['INFLAME','SPOT_WEAKNESS','DEMON_FORM'].filter(has).length*1.5;
  if(c.id==='BARRICADE')score+=(profile.defense>10?2:-2)+(has('ENTRENCH')?2:0);
  if(c.id==='ENTRENCH')score+=has('BARRICADE')?3:profile.defense>12?0:-5;
  if(c.id==='BODY_SLAM')score+=profile.defense>10?2:-2;
  if(c.id==='LIMIT_BREAK'&&!['INFLAME','SPOT_WEAKNESS','DEMON_FORM'].some(has))score-=5;
  if(c.id==='CLASH'&&o.game.deck.some(x=>describeCard(x.id,x.upgraded).type===3))score-=5;
  if(c.id==='PERFECTED_STRIKE')score+=o.game.deck.filter(x=>describeCard(x.id,x.upgraded).name.includes('Strike')).length*.25;
  score-=copies*(d.type===2?2:1);score-=Math.max(0,o.game.deck.length-22)*.12;
  return score+(c.upgraded?.7:0);
}
/** Upgrade an existing slot: compare its two marginal contributions against
 * the same remaining deck. Acquisition-only copy/size costs cancel. The cost
 * delta is original metadata; this preference never executes a card effect. */
export function upgradePreference(o:Observation,deckIndex:number):number{
  const card=o.game.deck[deckIndex]!,base={...o,game:{...o.game,deck:o.game.deck.filter((_,i)=>i!==deckIndex)}};
  const next={...card,upgraded:true};
  const gain=cardPreference(base,next)-cardPreference(base,card);
  const before=describeCard(card.id,card.upgraded).variant,after=describeCard(card.id,true).variant;
  const cheaper=Math.max(0,before.cost-after.cost);
  return gain+2*cheaper+(card.id==='BASH'?1:0);
}
const relicNames=new Map<number,string>(Object.entries(relicId).map(([name,id])=>[id,name]));
function relicPreference(id:number,o:Observation):number{
  const name=relicNames.get(id),p=deckProfile(o);
  if(['SOZU','ECTOPLASM','BUSTED_CROWN','VELVET_CHOKER','RUNIC_DOME'].includes(name??''))return 1;
  if(['COFFEE_DRIPPER','FUSION_HAMMER','CURSED_KEY','SLAVERS_COLLAR','PHILOSOPHERS_STONE','MARK_OF_PAIN'].includes(name??''))return 5;
  if(name==='SNECKO_EYE')return o.game.deck.filter(c=>describeCard(c.id,c.upgraded).variant.cost>=2).length>4?6:1;
  if(name==='RUNIC_PYRAMID')return p.flow>3?5:3;
  if(name==='BLACK_BLOOD')return 5;
  if(name==='DEAD_BRANCH')return p.exhaust>2?8:4;
  return 3;
}
export function adventureScore(o:Observation,bits:number):number{
  const a=describeAction(o,bits),g=o.game,h=g.hp/g.maxHp,p=deckProfile(o),d=a.details,i=Number(d.index??0);
  switch(a.kind){
    case 'take-gold':return 30;
    case 'take-relic':return g.screen==='BOSS_RELIC_REWARDS'?relicPreference(g.bossRelics![i]!,o):25;
    case 'take-key':return g.rewards?.emeraldKey?40:g.act>=2?35:2;
    case 'take-potion':return g.potions.includes(potionId.EMPTY_POTION_SLOT)?20:-100;
    case 'open-chest':return 30;
    case 'leave':return 0;
    case 'skip-card':return 0;
    case 'skip-relic':return -10;
    case 'take-card':return cardPreference(o,d.card as {id:string;upgraded:boolean});
    case 'buy-card':return cardPreference(o,g.shop!.cards[i]!)-g.shop!.prices[i]!/55;
    case 'buy-relic':return relicPreference(g.shop!.relics[i]!,o)-g.shop!.prices[7+i]!/65;
    case 'buy-potion':return g.potions.includes(potionId.EMPTY_POTION_SLOT)?1.8+(1-h)*3-g.shop!.prices[10+i]!/65:-100;
    case 'remove-card':return g.deck.some(c=>describeCard(c.id,c.upgraded).type===3)?7:g.deck.length>12?2.5-g.shop!.removeCost/100:-2;
    case 'select-card':{
      const c=d.card as {id:string;upgraded:boolean},type=g.select!.type;
      if(type===3)return upgradePreference(o,g.select!.cards[i]!.deckIndex);
      const value=cardPreference(o,c);
      if(type===4||type===8||type===1||type===2)return -value;
      return value;
    }
    case 'rest-option':{
      const option=Number(d.option);
      if(option===2)return !g.keys.red&&(g.act===3&&g.y>=10||g.act>=4)?50:!g.keys.red&&h>.85&&g.act>=2?5:-10;
      if(option===0)return h<.35?30:h<.6?12:h<.8?3:-5;
      if(option===1)return 6;
      if(option===3)return 7;
      if(option===4)return 4;
      if(option===5)return 8;
      return -5;
    }
    case 'travel':{
      const node=g.map.nodes.find(n=>n.x===d.x&&n.y===d.y);if(!node)return 0;
      const strong=p.attack>7&&p.defense>5,canRest=!g.relics.some(r=>r.id==='COFFEE_DRIPPER');
      const rooms:Record<string,number>={REST:2+(canRest?(1-h)*12:0),EVENT:3+(1-h)*4,MONSTER:2+h*3+(p.attack<8?3*h:0),ELITE:strong&&h>.7?6:-6+(h-.5)*10,SHOP:g.gold>200?7:g.gold>100?3:0,TREASURE:8,BOSS:0};
      // Public route preferences, never predicted HP or encounter execution.
      // A camp after an elite cannot erase the cost of reaching that elite.
      // Convex strain makes successive fights more costly than the same
      // rooms separated by a usable camp; no depth or path-count cutoff.
      const strain=(strong?.2:.45)+(1-h)*1.2,nodes=new Map(g.map.nodes.map(n=>[n.x+':'+n.y,n])),future=new Map<string,number>();
      const route=(row:typeof node,burden:number):number=>{
        const key=row.x+':'+row.y+':'+burden,known=future.get(key);if(known!==undefined)return known;
        const weight=row.room==='ELITE'?3:row.room==='MONSTER'?1:0;
        const nextBurden=row.room==='REST'&&canRest?0:burden+weight;
        const children=row.edges.flatMap(x=>{const child=nodes.get(x+':'+(row.y+1));return child?[child]:[];});
        const value=(rooms[row.room]??0)-strain*weight*(2*burden+weight)+
          (children.length?.8*Math.max(...children.map(child=>route(child,nextBurden))):0);
        future.set(key,value);return value;
      };
      let score=route(node,0);
      // Public map reachability only, no future encounters or event outcomes.
      if(canRest&&h<.65){let frontier=[node];for(let depth=1;depth<=3;depth++){
        frontier=frontier.flatMap(n=>g.map.nodes.filter(next=>next.y===n.y+1&&n.edges.includes(next.x)));
        if(frontier.some(n=>n.room==='REST')){score+=(1-h)*8/depth;break;}
      }}
      const descendants=new Set([node.x]);let reachableKey=false;
      for(let y=node.y;y<=g.map.burningEliteY;y++){const next=new Set<number>();for(const n of g.map.nodes.filter(n=>n.y===y&&descendants.has(n.x))){if(n.x===g.map.burningEliteX&&n.y===g.map.burningEliteY)reachableKey=true;for(const x of n.edges)next.add(x);}descendants.clear();for(const x of next)descendants.add(x);}
      if(!g.keys.green&&g.act===3)score+=reachableKey?20:-30;
      if(!g.keys.green&&node.x===g.map.burningEliteX&&node.y===g.map.burningEliteY)score+=g.act===3?20:strong&&h>.85?6:-6;
      return score;
    }
    case 'neow':case 'event-option':{
      // Preferences inspect the original published option text, never execute it.
      const text=a.label;let value=1;
      if(/回复|恢复|治疗/.test(text))value+=(1-h)*10;
      if(/金币/.test(text)&&!/失去|支付/.test(text))value+=2;
      if(/获得.*遗物/.test(text))value+=3;
      if(/升级/.test(text))value+=2;
      if(/移除/.test(text))value+=2;
      if(/诅咒/.test(text)||Object.entries(cards).some(([id,card])=>card.type===3&&new RegExp('获得[^；]*'+id).test(text)))value-=8;
      if(/失去.*生命|受到.*伤害|支付.*生命/.test(text))value-=2+(1-h)*8;
      if(/战斗/.test(text))value+=h>.9&&p.attack>7&&p.defense>5?1:-12;
      if(a.kind==='neow'&&/随机Boss遗物/.test(text))value-=10;
      if(/^(离开|无事|跳过)$/.test(text))value=0;
      return value;
    }
    case 'drink-potion':return h<.6?2:-20;
    case 'discard-potion':return -100;
    default:return 0;
  }
}
export function chooseAdventure(decision:PublicDecision,random:RandomCursor){
  const rows=decision.actions.map(a=>({key:String(a.bits),score:adventureScore(decision.observation,a.bits)}));
  const max=Math.max(...rows.map(r=>r.score));
  // Modest softmax exploration among plausible candidates; never borrow game RNG.
  const weights=rows.map(r=>Math.exp(Math.max(-700,(r.score-max)/.35))),total=weights.reduce((a,b)=>a+b,0);
  const word=searchEntropyWord(random);let cursor=(word.value/0x100000000)*total,index=rows.length-1;
  for(let i=0;i<weights.length;i++){cursor-=weights[i]!;if(cursor<0){index=i;break;}}
  return{action:decision.actions[index]!,random:word.random,rows,logProbability:Math.log(weights[index]!/total)};
}

/** Heuristic utility of original public states, not a damage/settlement model. */
export function combatValue(o:Observation,initial:Observation,elapsedTurns?:number):number{
  if(o.game.outcome===0)return -1;
  const b=o.battle,hp=b?.player.hp??o.game.hp,max=initial.battle?.player.maxHp??initial.game.maxHp;
  if(hp<=0)return -1;
  const turns=elapsedTurns??(b?Math.max(0,b.turn-(initial.battle?.turn??b.turn)):
    o.history.slice(initial.history.length).filter(action=>action.kind==='battle'&&action.bits>>>29===4).length);
  const potions=o.game.potions.filter(p=>p!==potionId.INVALID&&p!==potionId.EMPTY_POTION_SLOT).length;
  const growth=Math.max(-.04,Math.min(.04,(o.game.maxHp-initial.game.maxHp)*.0015+(o.game.gold-initial.game.gold)*.00003));
  if(!b)return Math.max(-.94,Math.min(.98,.2+.65*Math.min(1,hp/max)+growth+.005*potions-.025*turns));
  const incoming=(b.intents??[]).reduce((n,i)=>n+i.attackDamage*i.hits,0);
  // Read the original current intent, not a separate damage executor. Threat
  // removed by defeating an attacker must matter as much as covering it with
  // block. This is a local board feature, never predicted HP or a true-return
  // bound. Original settlement alone determines whether a branch really dies.
  const exposed=Math.max(0,incoming-b.player.block);
  // Threat consumes the remaining life reserve, not the original maximum.
  // The same uncovered intent is strategically more urgent at low HP. This
  // dimensionless pressure is not a second damage calculation or next HP.
  const pressure=exposed/hp;
  const initialEnemies=initial.battle?.monsters??b.monsters;
  const healthScale=Math.max(1,Math.min(300,initialEnemies.reduce((n,m)=>n+m.maxHp,0)));
  const enemy=.5*b.monsters.reduce((n,m)=>n+Math.max(0,m.hp),0)/healthScale+
    // Concavity gives concentrated damage a continuous advantage before a
    // kill: equal damage removes more of this term from a wounded enemy.
    // Only current public HP is used; this is not a kill/damage prediction.
    .2*b.monsters.reduce((n,m)=>n+Math.sqrt(Math.max(0,m.hp)/Math.max(1,m.maxHp)),0)/Math.max(1,initialEnemies.length)+
    // Permanent enemy scaling matters beyond the currently displayed attack.
    // This is a generic board penalty for already acquired strength, not an
    // enemy trigger table or a calculation of its future attacks.
    b.monsters.reduce((n,m)=>n+(m.hp>0?.1/Math.max(1,initialEnemies.length)+.012*Math.max(0,m.strength):0),0);
  // Enemy block is a transient obstacle, not lasting damage progress. In
  // particular a beneficial original phase change can grant enemy block.
  // Value actual HP/intent changes and let subsequent original attacks expose
  // the obstacle's cost; do not reward shaving block that may simply expire.
  const bits=BigInt(b.player.statusBits0)|(BigInt(b.player.statusBits1>>>0)<<64n);
  const level=(key:number)=>(bits&(1n<<BigInt(key)))===0n?0:b.player.statuses.find(row=>row[0]===key)?.[1]??1;
  // Discount the published expiry obligation in the persistent-stat feature.
  // Temporary stats earn value through original damage/block successors; an
  // unused potion must not look like a permanent improvement by itself.
  const strength=b.player.strength-Math.max(0,level(PS.LOSE_STRENGTH));
  const dexterity=b.player.dexterity-Math.max(0,level(PS.LOSE_DEXTERITY));
  const debuffs=[PS.WEAK,PS.FRAIL,PS.VULNERABLE].reduce((n,key)=>n+.012*Math.max(0,level(key)),0);
  const ability=[PS.CORRUPTION,PS.BARRICADE,PS.DARK_EMBRACE,PS.FEEL_NO_PAIN,PS.DEMON_FORM,PS.METALLICIZE,PS.PLATED_ARMOR,PS.REGEN,PS.JUGGERNAUT]
    .reduce((n,key)=>n+.025*Math.min(4,Math.max(0,level(key))),0);
  // A known status-heavy cycle makes an installed Evolve strategically
  // useful before its original draw reaction has fired. Count only published
  // cards, ignoring order and exhausted cards; this is neither a draw forecast
  // nor a replacement for the original power's queued execution. Saturation
  // prevents clutter or additional stacks from earning unbounded setup value.
  const evolve=Math.min(2,Math.max(0,level(PS.EVOLVE)));
  const statuses=evolve?[...b.hand,...b.discard,...(b.draw??[])].filter(c=>cards[c.id as keyof typeof cards].type===4).length:0;
  const statusFlow=.12*evolve*statuses/(statuses+5);
  const value=.65*Math.min(1,hp/max)-enemy-.5*pressure+.025*Math.min(12,strength)+.018*Math.min(12,dexterity)+
    .006*potions+growth-debuffs+ability+statusFlow-.025*turns-(exposed>=hp?.6:0);
  return .95*Math.tanh(value);
}

/** Unspent resources can make work promising; they are not realized value.
 * In particular drinking an energy potion must not earn a board reward just
 * for having energy which can be discarded by the next end-turn action. */
export function combatPriority(o:Observation,initial:Observation,elapsedTurns?:number):number{
  const b=o.battle,tempo=b&&b.turn===(initial.battle?.turn??0)?
    .04*Math.min(6,Math.max(0,b.player.energy))+.006*b.hand.filter(c=>c.costForTurn>=0&&c.costForTurn<=b.player.energy).length:0;
  return combatValue(o,initial,elapsedTurns)+tempo;
}
