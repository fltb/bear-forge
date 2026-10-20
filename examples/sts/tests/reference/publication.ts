// Test relation from source observations to the production player publication.
import {FrameSchema} from '../../src/game.schemas.ts';
import type {ReferenceState} from './client.ts';
import type {GameEvent} from '../../src/game.schemas.ts';
export function publishReference(s:ReferenceState,history:GameEvent[]) {
  const g=s.game,game:Record<string,unknown>={};
  for(const key of ['ascension','act','floor','screen','outcome','room','eventName','boss','x','y','hp','maxHp','gold','keys','deck','bottles','relics','potions','neow','select','rewards','shop','bossRelics','chestSize'])
    if(Object.hasOwn(g,key))game[key]=g[key];
  game.map={nodes:g.map.nodes,burningEliteX:g.map.burningEliteX,burningEliteY:g.map.burningEliteY};
  if(g.select){const {transformRng,...selection}=g.select;game.select=selection;}
  let battle=null;
  if(s.battle) {
    const b=s.battle;game.hp=b.player.hp;game.maxHp=b.player.maxHp;game.gold=b.player.gold;game.potions=b.potions;
    battle={turn:b.turn,player:b.player,monsters:b.monsters.map(m=>{
      const {id,miscInfo,halfDead,escaping,escapeNext,...visible}=m;return visible;
    }),hand:b.cards.hand,drawCount:b.cards.draw.length,discard:b.cards.discard,exhaust:b.cards.exhaust,
      ...(g.relics.some((r:{id:string})=>r.id==='FROZEN_EYE')?{draw:b.cards.draw}:{}),...(b.select?{select:b.select}:{})};
  }
  return FrameSchema.parse({game,battle,actions:s.actions.map(a=>({bits:a.bits})),decisions:s.decisions,heartDefeated:s.heartDefeated,history});
}
