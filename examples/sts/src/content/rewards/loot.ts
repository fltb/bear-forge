import {z} from 'zod';
import {typedValue} from '../../rules/value.schemas.ts';
import {rules} from '../../rules/execution.ts';
import {adventures,emptyAdventureRewards} from "../../rules/adventures.ts";
import {random} from "../../rules/random.ts";
import {relics,type RelicDefinition} from "../../rules/relics.ts";
import {adventureDraws} from "./draws.ts";
import type {AdventureRewards,CardPreview,RelicTier} from "../../rules/adventures.types.ts";
import type {Room} from "../../map.types.ts";
import type {createAdventureAcquisition} from "../relics/acquisition.ts";
import type {RelicId} from '../../identifiers.ts';
import {describeProgram,programText} from '../cards/shared/program-facts.ts';

type RewardInput={run:number;room:Room;rewards:AdventureRewards};
/** Conditions wrap the actual reward transformer, never a parallel rule table. */
export function rewardInRoom(id:RelicId,room:Room,child:rules.Effect<RewardInput,AdventureRewards>){
  const effect=rules.defineEffect<RewardInput,AdventureRewards>(b=>{const rewards=b.local<AdventureRewards>();return rules.sequence(
    rules.when(b.read(v=>v.input.room!==room||!v.query(adventures.exports.hasRelic,{run:v.input.run,id})),b.return(b.read(v=>v.input.rewards))),
    b.assign(rewards,rules.call(child,b.input)),b.return(rewards),
  );});
  const text=programText(child),label=room==='ELITE'?'精英战斗':room==='MONSTER'?'普通战斗':room;
  return text===undefined?effect:describeProgram(effect,`${label}，${text}。`);
}
const {defineRules,defineEffect,sequence,when,whileDo,call,query}=rules;
export function createAdventureLoot(acquisition:ReturnType<typeof createAdventureAcquisition>){return defineRules({requires:[acquisition,adventureDraws],build(){
  const tier=defineEffect<{run:number;elite:boolean},RelicTier>(b=>{const roll=b.local<number>();return sequence(b.assign(roll,call(random.exports.int,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams.relic),start:0,end:99})),b.return(b.read(v=>{const n=v.get(roll);return v.input.elite?n<50?'common':n>82?'rare':'uncommon':v.query(adventures.exports.position,v.input.run).act===4?'uncommon':n<50?'common':n<83?'uncommon':'rare';})));});
  const nonCampfireRelic=describeProgram(defineEffect<{run:number;tier:RelicTier},RelicDefinition>(b=>{const picked=b.local<RelicDefinition>();return whileDo(true,sequence(
    b.assign(picked,call(acquisition.exports.draw,{run:b.read(v=>v.input.run),tier:b.read(v=>v.input.tier),shop:false,front:true,screenless:false})),
    when(b.read(v=>!(['GIRYA','PEACE_PIPE','SHOVEL'] as const).some(id=>v.query(relics.exports.sameDefinition,[v.get(picked),v.query(adventures.exports.relic,{run:v.input.run,id})]))),b.return(picked)),
  ));}),'遗物（排除篝火选项遗物）');
  function statuePotionChance(limit:number){return{
    query:rules.defineQuery({input:typedValue<{run:number;rewards:AdventureRewards}>(),output:z.number(),dependencies:[adventures.exports.economy,adventures.exports.hasRelic],base:(r,input)=>{const reward=input.rewards,count=reward.gold.length+reward.cards.length+reward.relics.length+reward.potions.length;return count>=limit?0:r.query(adventures.exports.hasRelic,{run:input.run,id:'WHITE_BEAST_STATUE'})?100:40+r.query(adventures.exports.economy,input.run).potionChance;}}),
    text:`战斗药水奖励判定时，若已有奖励条目少于${limit}项，必定生成1瓶药水；达到上限则不生成。`,
  };}
  const whiteStatue=statuePotionChance(4);
  function bonusBattleGold(ratio:number){return{
    query:rules.defineQuery({input:z.object({run:z.number(),gold:z.number()}),output:z.number(),dependencies:[adventures.exports.hasRelic],base:(r,input)=>r.query(adventures.exports.hasRelic,{run:input.run,id:'GOLDEN_IDOL'})?input.gold+Math.round(Math.fround(Math.fround(input.gold)*Math.fround(ratio))):input.gold}),
    text:`战斗基础金币奖励增加${ratio*100}%（加成四舍五入）；不增加被偷后返还的金币。`,
  };}
  const goldenIdol=bonusBattleGold(.25);
  const potion=defineEffect<{run:number;rewards:AdventureRewards},AdventureRewards>(b=>{const roll=b.local<number>(),picked=b.local<number>(),chance=b.local<number>();return sequence(
    b.assign(chance,query(whiteStatue.query,b.input)),b.assign(roll,call(random.exports.mappedInt,b.read(v=>{const values=Array.from({length:100},(_,roll)=>Number(roll<v.get(chance)));return{stream:v.query(adventures.exports.bindings,v.input.run).streams.potion,values,declarations:values.map(value=>({name:'reward-potion-present',value}))};}))),
    when(b.read(v=>v.get(roll)===0),sequence(call(adventures.exports.setPotionChance,{run:b.read(v=>v.input.run),chance:b.read(v=>v.query(adventures.exports.economy,v.input.run).potionChance+10)}),b.return(b.read(v=>v.input.rewards)))),
    b.assign(picked,call(adventureDraws.exports.rewardPotion,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams.potion),publish:true})),call(adventures.exports.setPotionChance,{run:b.read(v=>v.input.run),chance:b.read(v=>v.query(adventures.exports.economy,v.input.run).potionChance-10)}),b.return(b.read(v=>({...v.input.rewards,potions:[...v.input.rewards.potions,v.get(picked)]}))),
  );});
  function extraRelic(draw:rules.Effect<{run:number;tier:RelicTier},RelicDefinition>){
    const effect=defineEffect<RewardInput,AdventureRewards>(b=>{const rank=b.local<RelicTier>(),relic=b.local<RelicDefinition>();return sequence(
      b.assign(rank,call(tier,{run:b.read(v=>v.input.run),elite:true})),b.assign(relic,call(draw,{run:b.read(v=>v.input.run),tier:rank})),b.return(b.read(v=>({...v.input.rewards,relics:[...v.input.rewards.relics,v.get(relic)]}))),
    );});
    const text=programText(draw);return text===undefined?effect:describeProgram(effect,`额外掉落1件${text}`);
  }
  function extraCards(room:Room){return describeProgram(defineEffect<RewardInput,AdventureRewards>(b=>{const cards=b.local<CardPreview[]>();return sequence(
    b.assign(cards,call(adventureDraws.exports.reward,{publish:true,run:b.read(v=>v.input.run),room})),b.return(b.read(v=>({...v.input.rewards,cards:[...v.input.rewards.cards,v.get(cards)]}))),
  );}),'额外获得1组卡牌奖励');}
  const blackStar=rewardInRoom('BLACK_STAR','ELITE',extraRelic(nonCampfireRelic));
  const prayerWheel=rewardInRoom('PRAYER_WHEEL','MONSTER',extraCards('MONSTER'));
  const battle=defineEffect<{run:number;room:Room},AdventureRewards>(b=>{const reward=b.local<AdventureRewards>(),gold=b.local<number>(),cards=b.local<CardPreview[]>(),relic=b.local<RelicDefinition>(),rank=b.local<RelicTier>();return sequence(
    b.assign(reward,emptyAdventureRewards()),
    b.assign(gold,call(random.exports.mappedInt,b.read(v=>{
      const values=Array.from({length:11},(_,index)=>{
        const base=v.input.room==='BOSS'?Math.round(Math.fround(Math.fround(95+index)*Math.fround(.75))):(v.input.room==='ELITE'?25:10)+index;
        return v.query(goldenIdol.query,{run:v.input.run,gold:base});
      });
      return{stream:v.query(adventures.exports.bindings,v.input.run).streams[v.input.room==='BOSS'?'misc':'treasure'],values,declarations:values.map(value=>({name:'reward-gold',value}))};
    }))),b.assign(reward,b.read(v=>({...v.get(reward),gold:[v.get(gold)]}))),
    when(b.read(v=>v.input.room==='ELITE'),sequence(
      b.assign(rank,call(tier,{run:b.read(v=>v.input.run),elite:true})),b.assign(relic,call(acquisition.exports.draw,{run:b.read(v=>v.input.run),tier:rank,shop:false,front:true,screenless:false})),b.assign(reward,b.read(v=>({...v.get(reward),relics:[...v.get(reward).relics,v.get(relic)]}))),
      b.assign(reward,call(blackStar,{run:b.read(v=>v.input.run),room:b.read(v=>v.input.room),rewards:reward})),
      b.assign(reward,b.read(v=>{const s=v.query(adventures.exports.location,v.input.run);return{...v.get(reward),emeraldKey:s.map.burningEliteX===s.x&&s.map.burningEliteY===s.y};})),
    )),
    b.assign(reward,call(potion,{run:b.read(v=>v.input.run),rewards:reward})),b.assign(cards,call(adventureDraws.exports.reward,{publish:true,run:b.read(v=>v.input.run),room:b.read(v=>v.input.room)})),b.assign(reward,b.read(v=>({...v.get(reward),cards:[...v.get(reward).cards,v.get(cards)]}))),
    b.assign(reward,call(prayerWheel,{run:b.read(v=>v.input.run),room:b.read(v=>v.input.room),rewards:reward})),when(b.read(v=>v.input.room==='MONSTER'&&v.query(adventures.exports.economy,v.input.run).stolenGold>0),b.assign(reward,b.read(v=>({...v.get(reward),gold:[...v.get(reward).gold,v.query(adventures.exports.economy,v.input.run).stolenGold]})))),b.return(reward),
  );});
  return{exports:{tier,potion,battle,relicTexts:Object.freeze(Object.fromEntries(Object.entries({WHITE_BEAST_STATUE:whiteStatue.text,GOLDEN_IDOL:goldenIdol.text,BLACK_STAR:programText(blackStar),PRAYER_WHEEL:programText(prayerWheel)}).filter((entry):entry is [string,string]=>entry[1]!==undefined)))}};
}});}
