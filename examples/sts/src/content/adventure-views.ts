import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {adventures} from '../rules/adventures.ts';
import {resources} from '../rules/resources.ts';
import {potions} from '../rules/potions.ts';
import {permanentDecks} from '../rules/permanent-decks.ts';
import {cardInstances} from '../rules/card-instances.ts';
import {relics} from '../rules/relics.ts';
import {random} from '../rules/random.ts';
import {shops} from '../rules/shops.ts';
import {battlePublications} from './battle-publications.ts';
import {PublicGameSchema,GameViewSchema} from '../game.schemas.ts';
import {cardId,relicId,eventId} from '../identifiers.ts';
import {eventNames,neowDescriptions} from '../pools.ts';
import type {CardPreview} from '../rules/adventures.types.ts';

const {defineRules,defineQuery}=rules;
const sourceRelicIds:Readonly<Record<string,number>>=relicId,sourceCardIds:Readonly<Record<string,number>>=cardId;
function relicNumber(id:string){const value=sourceRelicIds[id];if(value===undefined)throw Error('Unmapped source relic '+id);return value;}
function cardNumber(id:string){const value=sourceCardIds[id];if(value===undefined)throw Error('Unmapped source card '+id);return value;}
/** Publications borrow current owner values without rebuilding or mutating the game. */
export const adventureViews=defineRules({requires:[adventures,shops,battlePublications],build(){
  const game=defineQuery({input:z.number(),output:PublicGameSchema,
    dependencies:[adventures.exports.current,resources.exports.current,potions.exports.current,permanentDecks.exports.view,relics.exports.owned,relics.exports.view,shops.exports.forRun,shops.exports.current],
    kinds:[cardInstances.exports.kind,relics.exports.kind],base(r,run){
      const s=r.query(adventures.exports.current,run),p=r.query(resources.exports.current,s.actor),belt=r.query(potions.exports.current,s.potions),deck=r.query(permanentDecks.exports.view,s.deck);
      const card=(c:CardPreview)=>({id:r.definitionConfiguration(c.definition,cardInstances.exports.kind).id,misc:c.misc,upgraded:c.upgraded});
      const selected=(c:typeof s.selection.cards[number])=>({card:card(c.card),deckIndex:c.deckIndex});
      const shopId=r.query(shops.exports.forRun,run),shop=shopId===null?null:r.query(shops.exports.current,shopId);
      return {
        ascension:s.ascension,act:s.act,floor:s.floor,screen:s.screen,outcome:s.outcome,room:s.room,eventName:eventNames[s.event]!,boss:s.boss,x:s.x,y:s.y,
        hp:p.hp,maxHp:p.maxHp,gold:p.gold,keys:s.keys,deck:deck.deck,bottles:deck.bottles,
        relics:r.query(relics.exports.owned,s.actor).map(id=>r.query(relics.exports.view,id)),potions:belt.slots.slice(0,belt.capacity),
        map:{nodes:s.map.nodes,burningEliteX:s.map.burningEliteX,burningEliteY:s.map.burningEliteY},
        ...(s.screen==='EVENT_SCREEN'&&s.event===eventId.NEOW?{neow:s.neow.map(o=>({...o,description:neowDescriptions[o.bonus]!}))}:{}),
        ...(s.screen==='CARD_SELECT'?{select:{type:s.selection.type,remaining:s.selection.count,cards:s.selection.cards.map(selected),selected:s.selection.selected.map(selected)}}:{}),
        ...(s.screen==='REWARDS'?{rewards:{...s.rewards,cards:s.rewards.cards.map(list=>list.map(card)),relics:s.rewards.relics.map(def=>relicNumber(r.definitionConfiguration(def,relics.exports.kind).id))}}:{}),
        ...(s.screen==='SHOP_ROOM'&&shop?{shop:{prices:shop.prices,removeCost:shop.removeCost,cards:shop.cards.map(card),potions:shop.potions,relics:shop.relics.map(def=>relicNumber(r.definitionConfiguration(def,relics.exports.kind).id))}}:{}),
        ...(s.screen==='BOSS_RELIC_REWARDS'?{bossRelics:s.bossRelics.map(def=>relicNumber(r.definitionConfiguration(def,relics.exports.kind).id))}:{}),
        ...(s.screen==='TREASURE_ROOM'&&s.chest?{chestSize:s.chest.size}:{}),
      };
    }});
  const privateGame=defineQuery({input:z.number(),output:GameViewSchema,
    dependencies:[game,battlePublications.exports.privateForRun,adventures.exports.current,potions.exports.current,permanentDecks.exports.view,random.exports.current],
    kinds:[cardInstances.exports.kind,relics.exports.kind],base(r,run){
      const entry=r.query(battlePublications.exports.privateForRun,run);if(entry!==null)return entry;
      const s=r.query(adventures.exports.current,run),publicGame=r.query(game,run),deck=r.query(permanentDecks.exports.view,s.deck),belt=r.query(potions.exports.current,s.potions),bits=[0n,0n,0n];
      for(const relic of publicGame.relics){const n=relicId[relic.id as keyof typeof relicId];bits[Math.floor(n/64)]!|=1n<<BigInt(n%64);}
      const definitionId=(definition:CardPreview['definition'])=>r.definitionConfiguration(definition,cardInstances.exports.kind).id;
      return GameViewSchema.parse({
        ...publicGame,seed:s.seed.toString(),event:s.event,secondBoss:s.secondBoss,rng:Object.fromEntries(Object.entries(s.streams).map(([key,id])=>[key,r.query(random.exports.current,id)])),map:s.map,
        monsterList:s.monsterList,monsterOffset:s.monsterOffset,eliteList:s.eliteList,eliteOffset:s.eliteOffset,
        cardRarityFactor:s.cardRarityFactor,potionChance:s.potionChance,monsterChance:s.monsterChance,shopChance:s.shopChance,treasureChance:s.treasureChance,shopRemoveCount:s.shopRemoveCount,
        hasContinuation:s.hasContinuation,lastRoom:s.lastRoom,speedrunPace:s.speedrunPace,skipBattles:s.skipBattles,potionCount:belt.count,potionCapacity:belt.capacity,allPotions:belt.slots,
        noteForYourself:{id:definitionId(s.noteForYourself.definition),misc:s.noteForYourself.misc,upgraded:s.noteForYourself.upgraded},deckCounts:deck.deckCounts,upgradeableCount:deck.upgradeableCount,transformableCount:deck.transformableCount,
        relicBits:bits.map(String),eventList:s.eventList,shrineList:s.shrineList,oneTimeEvents:s.oneTimeEvents,
        relicPools:Object.fromEntries(Object.entries(s.relicPools).map(([key,list])=>[key,list.map(def=>relicNumber(r.definitionConfiguration(def,relics.exports.kind).id))])),colorlessPool:s.colorlessPool.map(def=>cardNumber(definitionId(def))),
        ...(s.screen==='EVENT_SCREEN'?{eventData:s.eventData}:{}),
        ...(publicGame.select?{select:{...publicGame.select,transformRng:[s.streams.misc,s.streams.card,s.streams.neow].indexOf(s.selection.transformStream)}}:{}),
      });
    }});
  return{exports:{game,privateGame}};
}});
