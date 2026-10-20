import {z} from 'zod';
import {rules,ruleModules,linkRules} from '@bear-forge/card-engine';
import {permanentDecks} from '../src/rules/permanent-decks.ts';
import {resources} from '../src/rules/resources.ts';
import {random} from '../src/rules/random.ts';
import {cardInstances} from '../src/rules/card-instances.ts';
import {relics} from '../src/rules/relics.ts';
import {basicCards} from '../src/content/basic-cards.ts';
import {permanentCards} from '../src/content/permanent-cards.ts';
import {deckRelics} from '../src/content/deck-relics.ts';
import {resourceRelics} from '../src/content/resource-relics.ts';
import type {CardConfig,CardSetup} from '../src/rules/card-instances.types.ts';
import type {DeckBatch} from '../src/rules/permanent-decks.types.ts';
import type {RelicDefinition} from '../src/rules/relics.ts';
const {defineRules,defineEffect,defineQuery,defineEntity,sequence,call,query,spawnEntity,forEach}=rules;
const contents={ASCENDERS_BANE:basicCards.exports.AscendersBane,STRIKE_RED:basicCards.exports.StrikeRed,DEFEND_RED:basicCards.exports.DefendRed,BASH:basicCards.exports.Bash,
  SEARING_BLOW:permanentCards.exports.SearingBlow,PARASITE:permanentCards.exports.Parasite,REGRET:permanentCards.exports.Regret,BARRICADE:permanentCards.exports.Barricade,SHRUG_IT_OFF:basicCards.exports.ShrugItOff,NECRONOMICURSE:permanentCards.exports.Necronomicurse,CURSE_OF_THE_BELL:permanentCards.exports.CurseOfTheBell};
const relicContents={OMAMORI:deckRelics.exports.Omamori,CERAMIC_FISH:deckRelics.exports.CeramicFish,MOLTEN_EGG:deckRelics.exports.MoltenEgg,TOXIC_EGG:deckRelics.exports.ToxicEgg,FROZEN_EGG:deckRelics.exports.FrozenEgg,ECTOPLASM:resourceRelics.exports.Ectoplasm,BLOODY_IDOL:resourceRelics.exports.BloodyIdol};
export type Name=keyof typeof contents;
export type RelicName=keyof typeof relicContents;
export type Step={kind:'obtain';id:Name;count?:number;upgraded?:boolean;misc?:number}|{kind:'remove';index:number}|{kind:'upgrade';index:number}|{kind:'upgrade-random';count:number}|{kind:'bottle';index:number;type:0|1|2};
const names=Object.keys(contents) as Name[],definitions=names.map(name=>contents[name]),relicNames=Object.keys(relicContents) as RelicName[],relicDefinitions=relicNames.map(name=>relicContents[name]);
const actorDefinition=defineEntity(resources.exports.actor,{side:0}),deckDefinition=defineEntity(permanentDecks.exports.kind,undefined),streamDefinition=defineEntity(random.exports.stream,undefined);
const views=defineRules({requires:[basicCards,permanentCards,deckRelics,resourceRelics],build(){return{exports:{view:defineQuery({input:z.object({deck:z.number(),stream:z.number()}),output:z.unknown(),dependencies:[permanentDecks.exports.current,permanentDecks.exports.view,resources.exports.current,random.exports.current,relics.exports.owned,relics.exports.view],base(r,i){const s=r.query(permanentDecks.exports.current,i.deck),actor=r.query(resources.exports.current,s.actor);return{...r.query(permanentDecks.exports.view,i.deck),hp:actor.hp,maxHp:actor.maxHp,gold:actor.gold,relics:r.query(relics.exports.owned,s.actor).map(id=>r.query(relics.exports.view,id)),miscRng:r.query(random.exports.current,i.stream)};}})}};}});
const probe=defineRules({requires:[views],build(){
  const publication=defineQuery({input:z.custom<rules.ChoiceRequest<number,number>>(),output:z.unknown(),dependencies:[permanentDecks.exports.current,permanentDecks.exports.view,resources.exports.current],base:(r,i)=>{const s=r.query(permanentDecks.exports.current,i.player);return{...r.query(permanentDecks.exports.view,i.player),pending:s.pending,gold:r.query(resources.exports.current,s.actor).gold};}});
  const adapter=ruleModules.choicePort({port:'probe',request:publication,reply:z.int32().min(0).max(1),decode:(_request,index)=>({kind:'selected',indices:[index]})});
  const pause=rules.on(permanentDecks.exports.obtaining,{condition:defineQuery({input:z.custom<rules.ReactionContext<DeckBatch>>(),output:z.boolean(),base:(_r,c)=>c.event.actor===c.owner&&c.event.count===2}),effect:defineEffect<rules.ReactionContext<DeckBatch>,void>(b=>{const chosen=b.local<rules.ChoiceResult<number>>();return sequence(
    b.assign(chosen,rules.chooseOne({adapter,player:b.read(v=>v.input.event.deck),candidates:[0,1],empty:'error',singleton:'request',allowSkip:false})),
    rules.when(b.read(v=>{const c=v.get(chosen);return c.kind==='selected'&&c.value===1;}),call(permanentDecks.exports.obtain,{deck:b.read(v=>v.input.event.deck),definition:permanentCards.exports.Regret,count:1,upgraded:false,specialData:0,upgrade:false})),
  );})});return{exports:{pause}};
}});
export let initializations=0;
export function fixture(steps:readonly Step[],owned:readonly RelicName[],seed:string,pause=false){
  const entry=defineEffect<void,unknown[]>(b=>{const actor=b.local<number>(),deck=b.local<number>(),stream=b.local<number>(),catalog=b.local<readonly rules.EntityDefinition<CardConfig,CardSetup>[]>(),relicCatalog=b.local<readonly RelicDefinition[]>(),history=b.local<unknown[]>();
    const view=()=>query(views.exports.view,{deck,stream});
    const cardAt=(index:number)=>b.read(v=>{const card=v.get(query(permanentDecks.exports.current,v.get(deck))).cards[index];if(card===undefined)throw Error('Invalid permanent card index');return card;});
    const obtain=(id:Name,count=1,upgraded=false,misc=0)=>call(permanentDecks.exports.obtain,{deck,definition:b.read(v=>v.get(catalog)[names.indexOf(id)]!),count,upgraded,specialData:misc,upgrade:false});
    return sequence(b.assign(catalog,definitions),b.assign(relicCatalog,relicDefinitions),b.assign(actor,spawnEntity({definition:actorDefinition,owner:null,scope:0,setup:{hp:68,maxHp:75,gold:99,block:0,energy:0}})),b.assign(stream,spawnEntity({definition:streamDefinition,owner:actor,scope:0,setup:BigInt(seed)})),b.assign(deck,spawnEntity({definition:deckDefinition,owner:actor,scope:0,setup:{actor}})),
      obtain('ASCENDERS_BANE'),obtain('STRIKE_RED',5),obtain('DEFEND_RED',4),obtain('BASH'),
      forEach(owned.map(id=>relicNames.indexOf(id)),index=>call(relics.exports.obtain,{actor,scope:0,definition:b.read(v=>v.get(relicCatalog)[v.get(index)]!)})),...(pause?[rules.install({ability:probe.exports.pause,source:actor,owner:actor,environment:{},lifetime:0})]:[]),b.assign(history,[view()]),
      ...steps.flatMap(step=>{const operation=step.kind==='obtain'?obtain(step.id,step.count??1,step.upgraded??false,step.misc??0):step.kind==='remove'?call(permanentDecks.exports.remove,{deck,card:cardAt(step.index)}):step.kind==='upgrade'?call(permanentDecks.exports.upgrade,{deck,card:cardAt(step.index)}):step.kind==='bottle'?call(permanentDecks.exports.bottle,{deck,index:step.index,type:step.type}):call(permanentDecks.exports.upgradeRandom,{deck,stream,count:step.count});return[operation,b.assign(history,b.read(v=>[...v.get(history),v.get(view())]))];}),b.return(history),
    );
  });
  return linkRules({id:'sts/permanent-deck-fixture-1',schemas:{setup:z.undefined(),result:z.array(z.unknown()),ports:{probe:{input:z.unknown(),output:z.int32().min(0).max(1)}}},initialize(){initializations++;return{};},entry,definitions:[entry],modules:[views,...(pause?[probe]:[])]});
}
