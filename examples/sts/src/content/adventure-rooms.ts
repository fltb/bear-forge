import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {rooms} from '../rules/rooms.ts';
import {adventures,emptyAdventureRewards} from '../rules/adventures.ts';
import {random} from '../rules/random.ts';
import {resources} from '../rules/resources.ts';
import {permanentDecks} from '../rules/permanent-decks.ts';
import {relics,type RelicDefinition} from '../rules/relics.ts';
import {adventureDraws} from './adventure-draws.ts';
import {adventureProgression} from './adventure-progression.ts';
import {combatProgram} from './combat-program.ts';
import {createAdventureLoot} from './adventure-loot.ts';
import type {createAdventureAcquisition} from './adventure-acquisition.ts';
import type {createMerchant} from './merchant.ts';
import type {AdventureChoiceExports} from '../rules/adventure-choices.ts';
import type {AdventureRewards,CardPreview,RelicTier} from '../rules/adventures.types.ts';
import type {Room} from '../map.types.ts';
import type {RelicId} from '../identifiers.ts';
import {eventId} from '../identifiers.ts';

export type AdventureEventExports={open:rules.Effect<number,void>;resolve:rules.Effect<number,Room>};
const {defineRules,defineQuery,defineEffect,defineEntity,sequence,when,forEach,call,query}=rules;
export function createAdventureRooms(ui:rules.RuleModule<AdventureChoiceExports>,acquisition:ReturnType<typeof createAdventureAcquisition>,merchant:ReturnType<typeof createMerchant>,events:rules.RuleModule<AdventureEventExports>){
  const loot=createAdventureLoot(acquisition);
  return defineRules({requires:[rooms,ui,acquisition,merchant,events,loot,adventureProgression,combatProgram],build(){
    const relicEntity=defineQuery({input:z.object({run:z.number(),id:z.custom<RelicId>()}),output:z.number().nullable(),dependencies:[adventures.exports.current,adventures.exports.relic,relics.exports.find],base:(r,i)=>r.query(relics.exports.find,{actor:r.query(adventures.exports.current,i.run).actor,definition:r.query(adventures.exports.relic,i)})});
    const relicData=defineQuery({input:z.object({run:z.number(),id:z.custom<RelicId>()}),output:z.number(),dependencies:[relicEntity,relics.exports.data],base:(r,i)=>{const e=r.query(relicEntity,i);return e===null?0:r.query(relics.exports.data,e);}});
    const interact=defineEffect<{run:number;id:RelicId},void>(b=>call(relics.exports.interact,b.read(v=>{const id=v.get(query(relicEntity,v.input));if(id===null)throw Error('Required relic is absent');return id;})));
    const map=defineEffect<number,void>(b=>call(adventures.exports.setScene,{run:b.input,screen:'MAP_SCREEN',continuation:false}));
    const mapKeep=defineEffect<number,void>(b=>call(adventures.exports.setScene,{run:b.input,screen:'MAP_SCREEN',continuation:true}));
    const reward=defineEffect<{run:number;reward:AdventureRewards},void>(b=>sequence(call(adventures.exports.setRewards,{run:b.read(v=>v.input.run),rewards:b.read(v=>v.input.reward)}),call(acquisition.exports.rewards,b.read(v=>v.input.run))));
    const battleReward=defineEffect<number,void>(b=>{const rewards=b.local<AdventureRewards>();return sequence(b.assign(rewards,call(loot.exports.battle,{run:b.input,room:b.read(v=>v.get(query(adventures.exports.current,v.input)).room)})),call(reward,{run:b.input,reward:rewards}));});
    const fight=defineEffect<{run:number;encounter:number},boolean>(b=>{const result=b.local<0|1|2>();return sequence(b.assign(result,call(combatProgram.exports.run,b.input)),when(b.read(v=>v.get(result)===2),sequence(call(adventures.exports.setOutcome,{run:b.read(v=>v.input.run),outcome:0}),b.return(false))),b.return(true));});
    const ordinaryFight=defineEffect<number,void>(b=>{const encounter=b.local<number>(),won=b.local<boolean>();return sequence(b.assign(encounter,call(adventures.exports.takeEncounter,{run:b.input,elite:b.read(v=>v.get(query(adventures.exports.current,v.input)).room==='ELITE')})),b.assign(won,call(fight,{run:b.input,encounter})),when(won,sequence(call(battleReward,b.input),call(map,b.input))));});
    const boss=defineEffect<number,void>(b=>{const won=b.local<boolean>(),relic=b.local<RelicDefinition>(),offered=b.local<RelicDefinition[]>(),chosen=b.local<number>();return sequence(
      b.assign(won,call(fight,{run:b.input,encounter:b.read(v=>v.get(query(adventures.exports.current,v.input)).boss)})),when(b.read(v=>!v.get(won)),b.return(undefined)),
      when(b.read(v=>v.get(query(adventures.exports.current,v.input)).act===4),sequence(call(adventures.exports.setOutcome,{run:b.input,outcome:2}),b.return(undefined))),
      when(b.read(v=>v.get(query(adventures.exports.current,v.input)).act===3),sequence(
        call(adventures.exports.incrementFloor,{run:b.input}),call(adventureProgression.exports.reseedFloor,b.input),call(adventures.exports.notifyEntered,{run:b.input,room:'BOSS'}),b.assign(won,call(fight,{run:b.input,encounter:b.read(v=>v.get(query(adventures.exports.current,v.input)).secondBoss)})),when(b.read(v=>!v.get(won)),b.return(undefined)),call(adventures.exports.incrementFloor,{run:b.input}),call(adventures.exports.notifyEntered,{run:b.input,room:'BOSS_TREASURE'}),when(b.read(v=>{const k=v.get(query(adventures.exports.current,v.input)).keys;return k.red&&k.green&&k.blue;}),call(adventureProgression.exports.nextAct,b.input),call(adventures.exports.setOutcome,{run:b.input,outcome:2})),b.return(undefined),
      )),
      call(battleReward,b.input),call(adventures.exports.incrementFloor,{run:b.input}),call(adventureProgression.exports.reseedFloor,b.input),call(adventures.exports.notifyEntered,{run:b.input,room:'BOSS_TREASURE'}),call(adventures.exports.setRoom,{run:b.input,room:'BOSS_TREASURE',event:eventId.INVALID}),b.assign(offered,[]),
      forEach([0,1,2],()=>sequence(b.assign(relic,call(acquisition.exports.draw,{run:b.input,tier:'boss',shop:false,front:true,screenless:false})),b.assign(offered,b.read(v=>[...v.get(offered),v.get(relic)])))),call(adventures.exports.setBossRelics,{run:b.input,relics:offered}),b.assign(chosen,call(ui.exports.choose,{run:b.input,actions:[0,1,2,3]})),when(b.read(v=>(v.get(chosen)&255)<3),call(acquisition.exports.give,{run:b.input,definition:b.read(v=>v.get(offered)[v.get(chosen)&255]!)})),call(adventureProgression.exports.nextAct,b.input),
    );});
    const rest=defineEffect<number,void>(b=>{const choice=b.local<number>(),cards=b.local<CardPreview[]>(),rank=b.local<RelicTier>(),relic=b.local<RelicDefinition>();return sequence(
      call(adventures.exports.setScene,{run:b.input,screen:'REST_ROOM',continuation:true}),b.assign(choice,call(ui.exports.choose,{run:b.input,actions:b.read(v=>{const s=v.get(query(adventures.exports.current,v.input)),out:number[]=[];if(!v.get(query(adventures.exports.hasRelic,{run:v.input,id:'COFFEE_DRIPPER'})))out.push(0);if(!v.get(query(adventures.exports.hasRelic,{run:v.input,id:'FUSION_HAMMER'}))&&v.get(query(permanentDecks.exports.current,s.deck)).upgradeable>0)out.push(1);if(!s.keys.red)out.push(2);if(v.get(query(adventures.exports.hasRelic,{run:v.input,id:'GIRYA'}))&&v.get(query(relicData,{run:v.input,id:'GIRYA'}))!==3)out.push(3);if(v.get(query(adventures.exports.hasRelic,{run:v.input,id:'PEACE_PIPE'})))out.push(4);if(v.get(query(adventures.exports.hasRelic,{run:v.input,id:'SHOVEL'})))out.push(5);return out.length?out:[6];})})),b.assign(choice,b.read(v=>v.get(choice)&255)),
      when(b.read(v=>v.get(choice)===0),sequence(
        call(resources.exports.heal,b.read(v=>{const entity=v.get(query(adventures.exports.current,v.input)).actor;return{entity,amount:Math.trunc(Math.fround(Math.fround(v.get(query(resources.exports.current,entity)).maxHp)*Math.fround(.3)))+(v.get(query(adventures.exports.hasRelic,{run:v.input,id:'REGAL_PILLOW'}))?15:0)};})),
        when(query(adventures.exports.hasRelic,{run:b.input,id:'DREAM_CATCHER'}),sequence(b.assign(cards,call(adventureDraws.exports.reward,{run:b.input,room:'REST'})),call(reward,{run:b.input,reward:{...emptyAdventureRewards(),cards:[cards]}}))),
      )),
      when(b.read(v=>v.get(choice)===1),call(acquisition.exports.selections.exports.select,{run:b.input,type:3,count:1,provided:null,stream:b.read(v=>v.get(query(adventures.exports.current,v.input)).selection.transformStream)})),
      when(b.read(v=>v.get(choice)===2),call(adventures.exports.setKeys,{run:b.input,keys:b.read(v=>({...v.get(query(adventures.exports.current,v.input)).keys,red:true}))})),
      when(b.read(v=>v.get(choice)===3),call(interact,{run:b.input,id:'GIRYA'})),
      when(b.read(v=>v.get(choice)===4),call(acquisition.exports.selections.exports.prepare,{run:b.input,type:4,count:1,provided:null,stream:b.read(v=>v.get(query(adventures.exports.current,v.input)).selection.transformStream)})),
      when(b.read(v=>v.get(choice)===5),sequence(b.assign(rank,call(loot.exports.tier,{run:b.input,elite:false})),b.assign(relic,call(acquisition.exports.draw,{run:b.input,tier:rank,shop:false,front:true,screenless:false})),call(reward,{run:b.input,reward:{...emptyAdventureRewards(),relics:[relic]}}))),
      call(mapKeep,b.input),
    );});
    const treasure=defineEffect<number,void>(b=>{const size=b.local<number>(),roll=b.local<number>(),choice=b.local<number>(),rank=b.local<RelicTier>(),relic=b.local<RelicDefinition>(),rewardValue=b.local<AdventureRewards>(),card=b.local<CardPreview>(),coin=b.local<boolean>();return sequence(
      b.assign(roll,call(random.exports.int,{stream:b.read(v=>v.get(query(adventures.exports.current,v.input)).streams.treasure),start:0,end:99})),b.assign(size,b.read(v=>v.get(roll)<50?0:v.get(roll)<83?1:2)),b.assign(roll,call(random.exports.int,{stream:b.read(v=>v.get(query(adventures.exports.current,v.input)).streams.treasure),start:0,end:99})),call(adventures.exports.setChest,{run:b.input,chest:b.read(v=>{const sizeValue=v.get(size),rollValue=v.get(roll),common=[75,35,0][sizeValue]!,uncommon=[25,50,75][sizeValue]!;return{size:sizeValue,haveGold:rollValue<[50,35,50][sizeValue]!,tier:rollValue<common?'common' as const:rollValue<common+uncommon?'uncommon' as const:'rare' as const};})}),
      b.assign(choice,call(ui.exports.choose,{run:b.input,actions:[0,1]})),when(b.read(v=>(v.get(choice)&255)!==0),sequence(call(mapKeep,b.input),b.return(undefined))),b.assign(rewardValue,emptyAdventureRewards()),
      when(b.read(v=>v.get(query(relicData,{run:v.input,id:'MATRYOSHKA'}))>0),sequence(b.assign(coin,call(random.exports.chance,{stream:b.read(v=>v.get(query(adventures.exports.current,v.input)).streams.relic),chance:.75})),b.assign(rank,b.read(v=>v.get(coin)?'common':'uncommon')),b.assign(relic,call(acquisition.exports.draw,{run:b.input,tier:rank,shop:false,front:true,screenless:false})),b.assign(rewardValue,b.read(v=>({...v.get(rewardValue),relics:[v.get(relic)]}))),call(interact,{run:b.input,id:'MATRYOSHKA'}))),
      when(query(adventures.exports.hasRelic,{run:b.input,id:'CURSED_KEY'}),sequence(b.assign(card,call(adventureDraws.exports.curse,b.input)),call(permanentDecks.exports.obtain,{deck:b.read(v=>v.get(query(adventures.exports.current,v.input)).deck),definition:b.read(v=>v.get(card).definition),upgraded:false,specialData:0,count:1,upgrade:false}))),
      when(b.read(v=>v.get(query(adventures.exports.current,v.input)).chest!.haveGold),sequence(b.assign(roll,call(random.exports.floatRange,{stream:b.read(v=>v.get(query(adventures.exports.current,v.input)).streams.treasure),start:b.read(v=>Math.fround([25,50,75][v.get(size)]!*Math.fround(.9))),end:b.read(v=>Math.fround([25,50,75][v.get(size)]!*Math.fround(1.1)))})),b.assign(rewardValue,b.read(v=>({...v.get(rewardValue),gold:[Math.round(v.get(roll))]}))))),
      b.assign(relic,call(acquisition.exports.draw,{run:b.input,tier:b.read(v=>v.get(query(adventures.exports.current,v.input)).chest!.tier),shop:false,front:true,screenless:false})),when(b.read(v=>v.get(query(relicData,{run:v.input,id:'NLOTHS_HUNGRY_FACE'}))>0),call(interact,{run:b.input,id:'NLOTHS_HUNGRY_FACE'}),b.assign(rewardValue,b.read(v=>({...v.get(rewardValue),relics:[...v.get(rewardValue).relics,v.get(relic)]})))),b.assign(rewardValue,b.read(v=>({...v.get(rewardValue),sapphireKey:!v.get(query(adventures.exports.current,v.input)).keys.blue}))),call(reward,{run:b.input,reward:rewardValue}),call(mapKeep,b.input),
    );});
    const shop=defineEffect<number,void>(b=>sequence(when(query(adventures.exports.hasRelic,{run:b.input,id:'MEAL_TICKET'}),call(resources.exports.heal,{entity:b.read(v=>v.get(query(adventures.exports.current,v.input)).actor),amount:15})),call(merchant.exports.open,b.input),call(adventures.exports.setScene,{run:b.input,screen:'MAP_SCREEN',continuation:true})));
    const room=(key:Room,enter:rules.Effect<number,void>)=>({key,definition:defineEntity(rooms.exports.kind,{enter:defineEffect<{run:number;room:number},void>(b=>call(enter,b.read(v=>v.input.run)))})});
    return{exports:{definitions:[room('MONSTER',ordinaryFight),room('ELITE',ordinaryFight),room('BOSS',boss),room('REST',rest),room('TREASURE',treasure),room('SHOP',shop),room('EVENT',events.exports.open)],resolveEvent:events.exports.resolve}};
  }});
}
