import {rules} from '@bear-forge/card-engine';
import {adventures,emptyAdventureRewards} from "../../rules/adventures.ts";
import {resources} from "../../rules/resources.ts";
import {random} from "../../rules/random.ts";
import {relics,type RelicDefinition} from "../../rules/relics.ts";
import {permanentDecks} from "../../rules/permanent-decks.ts";
import {potions} from "../../rules/potions.ts";
import {adventureDraws} from "../rewards/draws.ts";
import {adventureEventUtils,sourceFraction} from "./utils.ts";
import {eventId as e,type RelicId} from "../../identifiers.ts";
import type {CardPreview,RelicTier} from "../../rules/adventures.types.ts";
import type {AdventureChoiceExports} from "../../rules/adventure-choices.ts";
import type {createAdventureAcquisition} from "../relics/acquisition.ts";
import type {createAdventureLoot} from "../rewards/loot.ts";
const {defineRules,defineEffect,sequence,when,whileDo,forEach,call,query,despawnEntity}=rules;
export function createRepeatedAdventureEvents(ui:rules.RuleModule<AdventureChoiceExports>,acquisition:ReturnType<typeof createAdventureAcquisition>,loot:ReturnType<typeof createAdventureLoot>){return defineRules({requires:[ui,acquisition,loot,adventureDraws,adventureEventUtils],build(){
  const programs:Partial<Record<number,rules.Effect<number,void>>>={};
  const choose=defineEffect<{run:number;actions:readonly number[]},number>(b=>{const bits=b.local<number>();return sequence(b.assign(bits,call(ui.exports.choose,b.input)),b.return(b.read(v=>v.get(bits)&255)));});
  const run=(v:rules.ReadView<number>)=>v.get(query(adventures.exports.current,v.input));
  const hp=(v:rules.ReadView<number>)=>v.get(query(resources.exports.current,run(v).actor));
  const leave=defineEffect<number,void>(b=>call(adventures.exports.setScene,{run:b.input,screen:'MAP_SCREEN',continuation:b.read(v=>v.get(query(adventures.exports.current,v.input)).hasContinuation)}));
  const hurt=(amount:number|((v:rules.ReadView<number>)=>number),direct=true)=>defineEffect<number,void>(b=>call(adventureEventUtils.exports.hurt,{run:b.input,amount:typeof amount==='number'?amount:b.read(amount),direct}));
  const give=(id:RelicId)=>defineEffect<number,void>(b=>call(acquisition.exports.give,{run:b.input,definition:query(adventures.exports.relic,{run:b.input,id})}));
  const selection=(type:number)=>defineEffect<number,void>(b=>call(acquisition.exports.selections.exports.select,{run:b.input,type,count:1,provided:null,stream:b.read(v=>run(v).streams.misc)}));
  const randomRelic=defineEffect<number,RelicDefinition>(b=>{const tier=b.local<RelicTier>(),relic=b.local<RelicDefinition>();return sequence(b.assign(tier,call(loot.exports.tier,{run:b.input,elite:false})),b.assign(relic,call(acquisition.exports.draw,{run:b.input,tier,shop:false,front:true,screenless:true})),b.return(relic));});
  programs[e.CURSED_TOME]=defineEffect<number,void>(b=>{
    const choice=b.local<number>(),book=b.local<number>(),done=b.local<boolean>(),books=b.local<RelicDefinition[]>();
    return sequence(
      call(adventures.exports.setEventData,{run:b.input,data:0}),b.assign(done,false),
      whileDo(b.read(v=>!v.get(done)&&hp(v).hp>0),sequence(
        b.assign(choice,call(choose,{run:b.input,actions:b.read(v=>run(v).eventData===0?[0,1]:run(v).eventData<4?[run(v).eventData+1]:[5,6])})),
        when(b.read(v=>v.get(choice)===0),call(adventures.exports.setEventData,{run:b.input,data:1})),
        when(b.read(v=>v.get(choice)===1),sequence(call(leave,b.input),b.assign(done,true))),
        when(b.read(v=>v.get(choice)>=2&&v.get(choice)<=4),sequence(call(hurt(v=>run(v).eventData),b.input),call(adventures.exports.setEventData,{run:b.input,data:b.read(v=>run(v).eventData+1)}))),
        when(b.read(v=>v.get(choice)===5),sequence(
          call(hurt(v=>run(v).ascension>=15?15:10),b.input),b.assign(book,call(random.exports.int,{stream:b.read(v=>run(v).streams.misc),start:0,end:2})),
          b.assign(books,b.read(v=>(['NECRONOMICON','ENCHIRIDION','NILRYS_CODEX'] as const).map(id=>v.get(query(adventures.exports.relic,{run:v.input,id}))))),
          call(adventures.exports.setRewards,{run:b.input,rewards:{...emptyAdventureRewards(),relics:b.read(v=>[v.get(books)[v.get(book)]!])}}),
          when(b.read(v=>hp(v).hp>0),call(acquisition.exports.rewards,b.input)),call(leave,b.input),b.assign(done,true),
        )),
        when(b.read(v=>v.get(choice)===6),sequence(call(hurt(3),b.input),call(leave,b.input),b.assign(done,true))),
      )),
    );
  });
  programs[e.SCRAP_OOZE]=defineEffect<number,void>(b=>{const choice=b.local<number>(),roll=b.local<number>(),relic=b.local<RelicDefinition>(),done=b.local<boolean>();return sequence(b.assign(done,false),whileDo(b.read(v=>!v.get(done)&&hp(v).hp>0),sequence(b.assign(choice,call(choose,{run:b.input,actions:[0,1]})),when(b.read(v=>v.get(choice)===1),sequence(call(leave,b.input),b.assign(done,true)),sequence(call(hurt(v=>run(v).ascension>=15?5:3,false),b.input),b.assign(roll,call(random.exports.int,{stream:b.read(v=>run(v).streams.misc),start:0,end:99})),when(b.read(v=>v.get(roll)>=99-(run(v).eventData*10+25)),sequence(b.assign(relic,call(randomRelic,b.input)),call(acquisition.exports.give,{run:b.input,definition:relic}),call(leave,b.input),b.assign(done,true)),call(adventures.exports.setEventData,{run:b.input,data:b.read(v=>run(v).eventData+1)})))))));});
  programs[e.KNOWING_SKULL]=defineEffect<number,void>(b=>{const choice=b.local<number>(),costs=b.local<number[]>(),card=b.local<CardPreview>(),potion=b.local<number>(),done=b.local<boolean>();return sequence(b.assign(costs,[6,6,6]),b.assign(done,false),whileDo(b.read(v=>!v.get(done)&&hp(v).hp>0),sequence(b.assign(choice,call(choose,{run:b.input,actions:[0,1,2,3]})),when(b.read(v=>v.get(choice)===3),sequence(call(hurt(6),b.input),call(leave,b.input),b.assign(done,true)),sequence(call(adventureEventUtils.exports.hurt,{run:b.input,amount:b.read(v=>v.get(costs)[v.get(choice)]!),direct:true}),b.assign(costs,b.read(v=>v.get(costs).map((n,i)=>i===v.get(choice)?n+1:n))),when(b.read(v=>v.get(choice)===0),call(resources.exports.gainGold,{entity:b.read(v=>run(v).actor),amount:90}),when(b.read(v=>v.get(choice)===1),sequence(b.assign(card,call(adventureDraws.exports.shuffledColorless,{run:b.input,rarity:1})),call(permanentDecks.exports.obtain,{deck:b.read(v=>run(v).deck),definition:b.read(v=>v.get(card).definition),upgraded:false,specialData:0,count:1,upgrade:false})),sequence(b.assign(potion,call(adventureDraws.exports.potion,b.read(v=>run(v).streams.potion))),call(potions.exports.obtain,{inventory:b.read(v=>run(v).potions),potion})))))))));});
  programs[e.GOLDEN_IDOL]=defineEffect<number,void>(b=>{const choice=b.local<number>(),loss=b.local<number[]>();return sequence(b.assign(loss,b.read(v=>[sourceFraction(hp(v).maxHp,run(v).ascension>=15?.35:.25),sourceFraction(hp(v).maxHp,run(v).ascension>=15?.1:.08)])),b.assign(choice,call(choose,{run:b.input,actions:b.read(v=>v.get(query(adventures.exports.hasRelic,{run:v.input,id:'GOLDEN_IDOL'}))?[2,3,4]:[0,1])})),when(b.read(v=>v.get(choice)===0),sequence(call(give('GOLDEN_IDOL'),b.input),b.assign(choice,call(choose,{run:b.input,actions:[2,3,4]})))),when(b.read(v=>v.get(choice)===2),call(permanentDecks.exports.obtain,{deck:b.read(v=>run(v).deck),definition:query(adventures.exports.card,{run:b.input,id:'INJURY'}),count:1,upgraded:false,specialData:0,upgrade:false}),when(b.read(v=>v.get(choice)===3),call(adventureEventUtils.exports.hurt,{run:b.input,amount:b.read(v=>v.get(loss)[0]!),direct:false}),when(b.read(v=>v.get(choice)===4),call(resources.exports.loseMaxHp,{entity:b.read(v=>run(v).actor),amount:b.read(v=>v.get(loss)[1]!)})))),call(leave,b.input));});
  programs[e.FACE_TRADER]=defineEffect<number,void>(b=>{const choice=b.local<number>(),faces=b.local<RelicId[]>(),order=b.local<readonly RelicId[]>();return sequence(b.assign(choice,call(choose,{run:b.input,actions:[0,1,2]})),when(b.read(v=>v.get(choice)===0),sequence(call(resources.exports.gainGold,{entity:b.read(v=>run(v).actor),amount:b.read(v=>run(v).ascension>=15?50:75)}),call(hurt(v=>Math.max(1,sourceFraction(hp(v).maxHp,.1)),false),b.input)),when(b.read(v=>v.get(choice)===1),sequence(b.assign(faces,b.read(v=>(['CULTIST_HEADPIECE','FACE_OF_CLERIC','GREMLIN_VISAGE','NLOTHS_HUNGRY_FACE','SSSERPENT_HEAD'] as const).filter(id=>!v.get(query(adventures.exports.hasRelic,{run:v.input,id}))))),when(b.read(v=>v.get(faces).length===0),b.assign(faces,['CIRCLET'])),b.assign(order,random.exports.shuffle({stream:b.read(v=>run(v).streams.misc),items:faces})),call(acquisition.exports.give,{run:b.input,definition:query(adventures.exports.relic,{run:b.input,id:b.read(v=>v.get(order)[0]!)})})))),call(leave,b.input));});
  programs[e.BONFIRE_SPIRITS]=defineEffect<number,void>(b=>sequence(call(selection(8),b.input),call(adventures.exports.setScene,{run:b.input,screen:'MAP_SCREEN',continuation:true})));
  programs[e.WHEEL_OF_CHANGE]=defineEffect<number,void>(b=>{const result=b.local<number>(),relic=b.local<RelicDefinition>();return sequence(call(choose,{run:b.input,actions:[0]}),b.assign(result,call(random.exports.int,{stream:b.read(v=>run(v).streams.misc),start:0,end:5})),when(b.read(v=>v.get(result)===0),call(resources.exports.gainGold,{entity:b.read(v=>run(v).actor),amount:b.read(v=>run(v).act*100)}),when(b.read(v=>v.get(result)===1),sequence(b.assign(relic,call(randomRelic,b.input)),call(adventures.exports.setRewards,{run:b.input,rewards:{...emptyAdventureRewards(),relics:b.read(v=>[v.get(relic)])}}),call(acquisition.exports.rewards,b.input)),when(b.read(v=>v.get(result)===2),call(resources.exports.heal,{entity:b.read(v=>run(v).actor),amount:b.read(v=>hp(v).maxHp)}),when(b.read(v=>v.get(result)===3),call(permanentDecks.exports.obtain,{deck:b.read(v=>run(v).deck),definition:query(adventures.exports.card,{run:b.input,id:'DECAY'}),count:1,upgraded:false,specialData:0,upgrade:false}),when(b.read(v=>v.get(result)===4),call(selection(4),b.input),call(hurt(v=>sourceFraction(hp(v).maxHp,run(v).ascension>=15?.15:.1)),b.input)))))),call(leave,b.input));});
  programs[e.THE_LIBRARY]=defineEffect<number,void>(b=>{const choice=b.local<number>(),cards=b.local<CardPreview[]>(),heal=b.local<number>();return sequence(b.assign(heal,b.read(v=>sourceFraction(hp(v).maxHp,run(v).ascension>=15?.2:.33,'round'))),b.assign(choice,call(choose,{run:b.input,actions:[0,1]})),when(b.read(v=>v.get(choice)===0),sequence(b.assign(cards,call(adventureDraws.exports.library,b.input)),call(acquisition.exports.selections.exports.select,{run:b.input,type:6,count:1,provided:b.read(v=>v.get(cards).map(card=>({card,deckIndex:-1}))),stream:b.read(v=>run(v).streams.card)})),call(resources.exports.heal,{entity:b.read(v=>run(v).actor),amount:heal})),call(leave,b.input));});
  programs[e.SENSORY_STONE]=defineEffect<number,void>(b=>{const choice=b.local<number>(),cards=b.local<CardPreview[][]>(),reward=b.local<CardPreview[]>();return sequence(b.assign(choice,call(choose,{run:b.input,actions:[0,1,2]})),when(b.read(v=>v.get(choice)>0),call(adventureEventUtils.exports.hurt,{run:b.input,amount:b.read(v=>v.get(choice)*5),direct:true})),b.assign(cards,[]),forEach(b.read(v=>Array.from({length:v.get(choice)+1},(_,i)=>i)),()=>sequence(b.assign(reward,call(adventureDraws.exports.colorlessReward,b.input)),b.assign(cards,b.read(v=>[...v.get(cards),v.get(reward)])))),call(adventures.exports.setRewards,{run:b.input,rewards:{...emptyAdventureRewards(),cards}}),when(b.read(v=>hp(v).hp>0),call(acquisition.exports.rewards,b.input)),call(leave,b.input));});
  programs[e.DESIGNER_IN_SPIRE]=defineEffect<number,void>(b=>{const upgradeOne=b.local<boolean>(),removeOne=b.local<boolean>(),choice=b.local<number>();return sequence(
    b.assign(upgradeOne,call(random.exports.boolean,{stream:b.read(v=>run(v).streams.misc)})),b.assign(removeOne,call(random.exports.boolean,{stream:b.read(v=>run(v).streams.misc)})),
    b.assign(choice,call(choose,{run:b.input,actions:b.read(v=>{const s=run(v),p=hp(v),deck=v.get(query(permanentDecks.exports.current,s.deck)),actions=[5];if(p.gold>=(s.ascension>=15?50:40)&&deck.upgradeable>0)actions.push(v.get(upgradeOne)?0:1);if(p.gold>=(s.ascension>=15?75:60)&&deck.transformable>=(v.get(removeOne)?1:2))actions.push(v.get(removeOne)?2:3);if(p.gold>=(s.ascension>=15?110:90)&&deck.transformable>=1)actions.push(4);return actions.sort((a,b)=>a-b);})})),
    when(b.read(v=>v.get(choice)===0),sequence(call(resources.exports.spendGold,{entity:b.read(v=>run(v).actor),amount:b.read(v=>run(v).ascension>=15?50:40)}),call(selection(3),b.input))),
    when(b.read(v=>v.get(choice)===1),call(permanentDecks.exports.upgradeRandom,{deck:b.read(v=>run(v).deck),stream:b.read(v=>run(v).streams.misc),count:2})),
    when(b.read(v=>v.get(choice)===2),sequence(call(resources.exports.spendGold,{entity:b.read(v=>run(v).actor),amount:b.read(v=>run(v).ascension>=15?75:60)}),call(selection(4),b.input))),
    // Source case 3 has no transform implementation and falls into 4, then 5.
    // Case 5 immediately invokes the newly installed callback: upgrade once and
    // return to the map, replacing the pending removal screen before any reply.
    when(b.read(v=>v.get(choice)===3||v.get(choice)===4),sequence(
      when(b.read(v=>v.get(choice)===3),call(resources.exports.spendGold,{entity:b.read(v=>run(v).actor),amount:b.read(v=>run(v).ascension>=15?75:60)})),
      call(resources.exports.spendGold,{entity:b.read(v=>run(v).actor),amount:b.read(v=>run(v).ascension>=15?110:90)}),call(hurt(v=>run(v).ascension>=15?5:3),b.input),
      call(permanentDecks.exports.upgradeRandom,{deck:b.read(v=>run(v).deck),stream:b.read(v=>run(v).streams.misc),count:1}),call(adventures.exports.setScene,{run:b.input,screen:'MAP_SCREEN',continuation:false}),
    )),when(b.read(v=>v.get(choice)===5),call(hurt(v=>run(v).ascension>=15?5:3),b.input)),call(leave,b.input),
  );});

  return{exports:{programs}};
}});}
