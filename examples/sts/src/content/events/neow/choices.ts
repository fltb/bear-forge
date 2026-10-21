import {rules} from '@bear-forge/card-engine';
import {adventures,emptyAdventureRewards} from "../../../rules/adventures.ts";
import {permanentDecks} from "../../../rules/permanent-decks.ts";
import {resources} from "../../../rules/resources.ts";
import {relics,type RelicDefinition} from "../../../rules/relics.ts";
import {adventureDraws} from "../../rewards/draws.ts";
import type {AdventureChoiceExports} from "../../../rules/adventure-choices.ts";
import type {CardPreview,AdventureRewards} from "../../../rules/adventures.types.ts";
import type {NeowOption} from "../../../neow.types.ts";
import type {createAdventureAcquisition} from "../../relics/acquisition.ts";

const {defineRules,defineEffect,sequence,when,forEach,call,query,despawnEntity}=rules;
/** Each branch is a concrete rule program; nested screens return through ordinary call frames. */
export function createNeowChoices(ui:rules.RuleModule<AdventureChoiceExports>,acquisition:ReturnType<typeof createAdventureAcquisition>){return defineRules({requires:[ui,acquisition,adventureDraws],build(){
  const obtain=defineEffect<{run:number;card:CardPreview},void>(b=>call(permanentDecks.exports.obtain,{
    deck:b.read(v=>v.get(query(adventures.exports.current,v.input.run)).deck),definition:b.read(v=>v.input.card.definition),upgraded:b.read(v=>v.input.card.upgraded),specialData:b.read(v=>v.input.card.misc),count:1,upgrade:false,
  }));
  const curse=defineEffect<number,void>(b=>{const card=b.local<CardPreview>();return sequence(b.assign(card,call(adventureDraws.exports.curse,b.input)),call(obtain,{run:b.input,card}));});
  const toMap=defineEffect<number,void>(b=>call(adventures.exports.setScene,{run:b.input,screen:'MAP_SCREEN',continuation:false}));
  const resume=defineEffect<{run:number;option:NeowOption},void>(b=>sequence(
    when(b.read(v=>v.input.option.drawback===4),sequence(call(curse,b.read(v=>v.input.run)),call(adventures.exports.setScene,{run:b.read(v=>v.input.run),screen:'MAP_SCREEN',continuation:true})),call(toMap,b.read(v=>v.input.run))),
  ));
  const drawback=defineEffect<{run:number;option:NeowOption},void>(b=>{const starter=b.local<number|null>();return sequence(
    when(b.read(v=>v.input.option.drawback===2),call(resources.exports.loseMaxHp,b.read(v=>{const entity=v.get(query(adventures.exports.current,v.input.run)).actor,p=v.get(query(resources.exports.current,entity));return{entity,amount:p.maxHp-Math.trunc(Math.fround(Math.fround(.9)*Math.fround(p.maxHp)))};}))),
    when(b.read(v=>v.input.option.drawback===3),call(resources.exports.spendGold,b.read(v=>{const entity=v.get(query(adventures.exports.current,v.input.run)).actor;return{entity,amount:v.get(query(resources.exports.current,entity)).gold};}))),
    when(b.read(v=>v.input.option.drawback===5),call(resources.exports.limitHp,b.read(v=>{const entity=v.get(query(adventures.exports.current,v.input.run)).actor;return{entity,amount:Math.trunc(v.get(query(resources.exports.current,entity)).hp/10)*7};}))),
    when(b.read(v=>v.input.option.drawback===6),sequence(b.assign(starter,query(relics.exports.find,{actor:b.read(v=>v.get(query(adventures.exports.current,v.input.run)).actor),definition:query(adventures.exports.relic,{run:b.read(v=>v.input.run),id:'BURNING_BLOOD'})})),when(b.read(v=>v.get(starter)!==null),despawnEntity({entity:b.read(v=>v.get(starter)!),reason:{replaced:true}})))),
  );});
  const choose=defineEffect<number,void>(b=>{
    const index=b.local<number>(),option=b.local<NeowOption>(),cards=b.local<CardPreview[]>(),card=b.local<CardPreview>(),reward=b.local<AdventureRewards>(),potion=b.local<number>(),relic=b.local<RelicDefinition>();
    const selection=(type:number,count:number)=>({run:b.input,type,count,provided:null,stream:b.read(v=>v.get(query(adventures.exports.current,v.input)).selection.transformStream)});
    const finish=()=>call(resume,{run:b.input,option});
    return sequence(
      b.assign(index,call(ui.exports.choose,{run:b.input,actions:[0,1,2,3]})),b.assign(option,b.read(v=>{const o=v.get(query(adventures.exports.current,v.input)).neow[v.get(index)&255];if(!o)throw Error('Invalid Neow option');return o;})),
      call(drawback,{run:b.input,option}),call(adventures.exports.setScene,{run:b.input,screen:'EVENT_SCREEN',continuation:true}),
      when(b.read(v=>[0,5,11,14].includes(v.get(option).bonus)),sequence(
        finish(),call(adventures.exports.setScene,{run:b.input,screen:'MAP_SCREEN',continuation:true}),
        b.assign(cards,call(adventureDraws.exports.neow,{run:b.input,rare:b.read(v=>v.get(option).bonus===11||v.get(option).bonus===14),colorless:b.read(v=>v.get(option).bonus===5||v.get(option).bonus===11)})),
        call(adventures.exports.setRewards,{run:b.input,rewards:{gold:[],cards:[cards],relics:[],potions:[],emeraldKey:false,sapphireKey:false}}),call(acquisition.exports.rewards,b.input),call(toMap,b.input),b.return(undefined),
      )),
      when(b.read(v=>v.get(option).bonus===1),sequence(b.assign(card,call(adventureDraws.exports.classCard,{run:b.input,stream:b.read(v=>v.get(query(adventures.exports.current,v.input)).streams.neow),rarity:2})),call(obtain,{run:b.input,card}),finish(),b.return(undefined))),
      when(b.read(v=>v.get(option).bonus===2||v.get(option).bonus===12),sequence(call(acquisition.exports.selections.exports.select,{...selection(4,1),count:b.read(v=>v.get(option).bonus===2?1:2)}),finish(),b.return(undefined))),
      when(b.read(v=>v.get(option).bonus===3),sequence(call(acquisition.exports.selections.exports.select,selection(3,1)),finish(),b.return(undefined))),
      when(b.read(v=>v.get(option).bonus===4),sequence(call(adventures.exports.setTransformStream,{run:b.input,stream:b.read(v=>v.get(query(adventures.exports.current,v.input)).streams.neow)}),call(acquisition.exports.selections.exports.select,selection(1,1)),finish(),b.return(undefined))),
      when(b.read(v=>v.get(option).bonus===6),sequence(
        call(adventureDraws.exports.reward,{run:b.input,room:'EVENT'}),b.assign(reward,emptyAdventureRewards()),
        forEach([0,1,2],()=>sequence(b.assign(potion,call(adventureDraws.exports.potion,b.read(v=>v.get(query(adventures.exports.current,v.input)).streams.potion))),b.assign(reward,b.read(v=>({...v.get(reward),potions:[...v.get(reward).potions,v.get(potion)]}))))),
        call(adventures.exports.setRewards,{run:b.input,rewards:reward}),call(acquisition.exports.rewards,b.input),finish(),b.return(undefined),
      )),
      when(b.read(v=>v.get(option).bonus===7||v.get(option).bonus===13||v.get(option).bonus===18),sequence(
        b.assign(relic,call(acquisition.exports.draw,{run:b.input,tier:b.read(v=>v.get(option).bonus===7?'common' as const:v.get(option).bonus===13?'rare' as const:'boss' as const),shop:false,front:true,screenless:false})),
        call(acquisition.exports.give,{run:b.input,definition:relic}),finish(),b.return(undefined),
      )),
      when(b.read(v=>v.get(option).bonus===8||v.get(option).bonus===17),sequence(call(resources.exports.increaseMaxHp,b.read(v=>{const entity=v.get(query(adventures.exports.current,v.input)).actor,p=v.get(query(resources.exports.current,entity));return{entity,amount:Math.trunc(Math.fround(Math.fround(p.maxHp)*Math.fround(v.get(option).bonus===8?.1:.2)))};})),finish(),b.return(undefined))),
      when(b.read(v=>v.get(option).bonus===9),sequence(call(acquisition.exports.give,{run:b.input,definition:query(adventures.exports.relic,{run:b.input,id:'NEOWS_LAMENT'})}),finish(),b.return(undefined))),
      when(b.read(v=>v.get(option).bonus===10||v.get(option).bonus===15),sequence(call(resources.exports.gainGold,{entity:b.read(v=>v.get(query(adventures.exports.current,v.input)).actor),amount:b.read(v=>v.get(option).bonus===10?100:250)}),finish(),b.return(undefined))),
      when(b.read(v=>v.get(option).bonus===16),sequence(
        call(adventures.exports.setTransformStream,{run:b.input,stream:b.read(v=>v.get(query(adventures.exports.current,v.input)).streams.neow)}),call(acquisition.exports.selections.exports.prepare,selection(1,2)),call(curse,b.input),call(acquisition.exports.selections.exports.finish,{run:b.input}),call(toMap,b.input),b.return(undefined),
      )),
      b.return(b.read(()=>{throw Error('Invalid Neow bonus');})),
    );
  });
  return{exports:{choose}};
}});}
