import {rules} from '@bear-forge/card-engine';
import {adventures,emptyAdventureRewards} from '../rules/adventures.ts';
import {random} from '../rules/random.ts';
import {relics,type RelicDefinition} from '../rules/relics.ts';
import {adventureDraws} from './adventure-draws.ts';
import type {AdventureRewards,CardPreview,RelicTier} from '../rules/adventures.types.ts';
import type {Room} from '../map.types.ts';
import type {createAdventureAcquisition} from './adventure-acquisition.ts';
const {defineRules,defineEffect,sequence,when,whileDo,call,query}=rules;
export function createAdventureLoot(acquisition:ReturnType<typeof createAdventureAcquisition>){return defineRules({requires:[acquisition,adventureDraws],build(){
  const tier=defineEffect<{run:number;elite:boolean},RelicTier>(b=>{const roll=b.local<number>();return sequence(b.assign(roll,call(random.exports.int,{stream:b.read(v=>v.get(query(adventures.exports.current,v.input.run)).streams.relic),start:0,end:99})),b.return(b.read(v=>{const n=v.get(roll);return v.input.elite?n<50?'common':n>82?'rare':'uncommon':v.get(query(adventures.exports.current,v.input.run)).act===4?'uncommon':n<50?'common':n<83?'uncommon':'rare';})));});
  const nonCampfireRelic=defineEffect<{run:number;tier:RelicTier},RelicDefinition>(b=>{const picked=b.local<RelicDefinition>();return whileDo(true,sequence(
    b.assign(picked,call(acquisition.exports.draw,{run:b.read(v=>v.input.run),tier:b.read(v=>v.input.tier),shop:false,front:true,screenless:false})),
    when(b.read(v=>!(['GIRYA','PEACE_PIPE','SHOVEL'] as const).some(id=>v.get(query(relics.exports.sameDefinition,[v.get(picked),v.get(query(adventures.exports.relic,{run:v.input.run,id}))])))),b.return(picked)),
  ));});
  const potion=defineEffect<{run:number;rewards:AdventureRewards},AdventureRewards>(b=>{const roll=b.local<number>(),picked=b.local<number>(),chance=b.local<number>();return sequence(
    b.assign(chance,b.read(v=>{const s=v.get(query(adventures.exports.current,v.input.run)),r=v.input.rewards,count=r.gold.length+r.cards.length+r.relics.length+r.potions.length;return count>=4?0:v.get(query(adventures.exports.hasRelic,{run:v.input.run,id:'WHITE_BEAST_STATUE'}))?100:40+s.potionChance;})),b.assign(roll,call(random.exports.int,{stream:b.read(v=>v.get(query(adventures.exports.current,v.input.run)).streams.potion),start:0,end:99})),
    when(b.read(v=>v.get(roll)>=v.get(chance)),sequence(call(adventures.exports.setPotionChance,{run:b.read(v=>v.input.run),chance:b.read(v=>v.get(query(adventures.exports.current,v.input.run)).potionChance+10)}),b.return(b.read(v=>v.input.rewards)))),
    b.assign(picked,call(adventureDraws.exports.rewardPotion,b.read(v=>v.get(query(adventures.exports.current,v.input.run)).streams.potion))),call(adventures.exports.setPotionChance,{run:b.read(v=>v.input.run),chance:b.read(v=>v.get(query(adventures.exports.current,v.input.run)).potionChance-10)}),b.return(b.read(v=>({...v.input.rewards,potions:[...v.input.rewards.potions,v.get(picked)]}))),
  );});
  const battle=defineEffect<{run:number;room:Room},AdventureRewards>(b=>{const reward=b.local<AdventureRewards>(),gold=b.local<number>(),cards=b.local<CardPreview[]>(),relic=b.local<RelicDefinition>(),rank=b.local<RelicTier>();return sequence(
    b.assign(reward,emptyAdventureRewards()),
    when(b.read(v=>v.input.room==='BOSS'),sequence(b.assign(gold,call(random.exports.int,{stream:b.read(v=>v.get(query(adventures.exports.current,v.input.run)).streams.misc),start:-5,end:5})),b.assign(gold,b.read(v=>Math.round(Math.fround(Math.fround(100+v.get(gold))*Math.fround(.75)))))),b.assign(gold,call(random.exports.int,{stream:b.read(v=>v.get(query(adventures.exports.current,v.input.run)).streams.treasure),start:b.read(v=>v.input.room==='ELITE'?25:10),end:b.read(v=>v.input.room==='ELITE'?35:20)}))),
    when(query(adventures.exports.hasRelic,{run:b.read(v=>v.input.run),id:'GOLDEN_IDOL'}),b.assign(gold,b.read(v=>v.get(gold)+Math.round(Math.fround(Math.fround(v.get(gold))*Math.fround(.25)))))),b.assign(reward,b.read(v=>({...v.get(reward),gold:[v.get(gold)]}))),
    when(b.read(v=>v.input.room==='ELITE'),sequence(
      b.assign(rank,call(tier,{run:b.read(v=>v.input.run),elite:true})),b.assign(relic,call(acquisition.exports.draw,{run:b.read(v=>v.input.run),tier:rank,shop:false,front:true,screenless:false})),b.assign(reward,b.read(v=>({...v.get(reward),relics:[...v.get(reward).relics,v.get(relic)]}))),
      when(query(adventures.exports.hasRelic,{run:b.read(v=>v.input.run),id:'BLACK_STAR'}),sequence(b.assign(rank,call(tier,{run:b.read(v=>v.input.run),elite:true})),b.assign(relic,call(nonCampfireRelic,{run:b.read(v=>v.input.run),tier:rank})),b.assign(reward,b.read(v=>({...v.get(reward),relics:[...v.get(reward).relics,v.get(relic)]}))))),
      b.assign(reward,b.read(v=>{const s=v.get(query(adventures.exports.current,v.input.run));return{...v.get(reward),emeraldKey:s.map.burningEliteX===s.x&&s.map.burningEliteY===s.y};})),
    )),
    b.assign(reward,call(potion,{run:b.read(v=>v.input.run),rewards:reward})),b.assign(cards,call(adventureDraws.exports.reward,{run:b.read(v=>v.input.run),room:b.read(v=>v.input.room)})),b.assign(reward,b.read(v=>({...v.get(reward),cards:[...v.get(reward).cards,v.get(cards)]}))),
    when(b.read(v=>v.input.room==='MONSTER'&&v.get(query(adventures.exports.hasRelic,{run:v.input.run,id:'PRAYER_WHEEL'}))),sequence(b.assign(cards,call(adventureDraws.exports.reward,{run:b.read(v=>v.input.run),room:'MONSTER'})),b.assign(reward,b.read(v=>({...v.get(reward),cards:[...v.get(reward).cards,v.get(cards)]}))))),when(b.read(v=>v.input.room==='MONSTER'&&v.get(query(adventures.exports.current,v.input.run)).stolenGold>0),b.assign(reward,b.read(v=>({...v.get(reward),gold:[...v.get(reward).gold,v.get(query(adventures.exports.current,v.input.run)).stolenGold]})))),b.return(reward),
  );});
  return{exports:{tier,potion,battle}};
}});}
