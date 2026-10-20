import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {rules,ruleModules,linkRules} from '@bear-forge/card-engine';
import {createCardLoader} from '@bear-forge/runtime-card';
import {zones} from '../src/rules/zones.ts';
import {resources} from '../src/rules/resources.ts';
import {random} from '../src/rules/random.ts';
import {powers} from '../src/rules/powers.ts';
import {cardInstances} from '../src/rules/card-instances.ts';
import {cardPiles} from '../src/rules/card-piles.ts';
import {actionQueue,combatScope} from '../src/rules/combat-actions.ts';
import {drawPowers} from '../src/content/draw-powers.ts';
import {pileRelics} from '../src/content/pile-relics.ts';
import {pileCards} from '../src/content/pile-cards.ts';
import {upgradeOnce,standardUpgrade} from '../src/content/card-utils.ts';
import {cards} from '../src/cards.ts';
import {cardId,relicId} from '../src/identifiers.ts';
import {PS} from '../src/combat-identifiers.ts';
import type {CardConfig,CardSetup,CardUse} from '../src/rules/card-instances.types.ts';
import type {PowerDefinition} from '../src/rules/powers.types.ts';
import {ReferenceClient} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';
const {defineRules,defineQuery,defineEntity,defineEffect,sequence,call,query,forEach,spawnEntity,when}=rules;
const unbounded=defineEntity(zones.exports.kind,{capacity:null}),hand=defineEntity(zones.exports.kind,{capacity:10});
const actor=defineEntity(resources.exports.actor,{side:0}),stream=defineEntity(random.exports.stream,undefined),pileDefinition=defineEntity(cardPiles.exports.kind,undefined),registryDefinition=defineEntity(powers.exports.registryKind,undefined);
const noop=defineEffect<CardUse,void>(b=>b.return(undefined));
type CardId=keyof typeof cards;
const names=Object.keys(cards) as CardId[];
// Ordinary entries are isolated pile fixtures, not replacements for unimplemented production card programs.
const definitions=names.map(id=>id==='VOID'?pileCards.exports.Void:id==='SENTINEL'?pileCards.exports.Sentinel:defineEntity(cardInstances.exports.kind,{id,metadata:cards[id],use:noop,canUpgrade:upgradeOnce(cards[id]),upgrade:standardUpgrade(cards[id])}));
const powerBindings=[{definition:drawPowers.exports.NoDraw,id:PS.NO_DRAW},{definition:drawPowers.exports.Confused,id:PS.CONFUSED,flag:true},{definition:drawPowers.exports.Evolve,id:PS.EVOLVE},{definition:drawPowers.exports.DarkEmbrace,id:PS.DARK_EMBRACE},{definition:drawPowers.exports.FeelNoPain,id:PS.FEEL_NO_PAIN}];
const views=defineRules({requires:[drawPowers,pileRelics,pileCards],build(){return{exports:{view:defineQuery({
  input:z.object({piles:z.number(),registry:z.number(),sundial:z.number().nullable()}),output:z.any(),dependencies:[cardPiles.exports.current,zones.exports.members,cardInstances.exports.combatView,cardInstances.exports.metadata,resources.exports.current,random.exports.current,powers.exports.find,powers.exports.current,pileRelics.exports.sundialCount],
  base(r,input){
    const p=r.query(cardPiles.exports.current,input.piles),resource=r.query(resources.exports.current,p.actor);
    const pile=(zone:number)=>r.query(zones.exports.members,zone).map(entity=>({entity,view:r.query(cardInstances.exports.combatView,entity)}));
    const draw=pile(p.draw),hand=pile(p.hand),discard=pile(p.discard),exhaust=pile(p.exhaust),live=[...draw,...hand,...discard];
    const blood=(list:typeof draw)=>list.filter(c=>c.view.id==='BLOOD_FOR_BLOOD'||c.view.id==='MASTERFUL_STAB').length;
    let bits=0n;const statuses:number[][]=[];
    for(const binding of powerBindings){const entity=r.query(powers.exports.find,{registry:input.registry,actor:p.actor,definition:binding.definition});if(entity===null)continue;const state=r.query(powers.exports.current,entity);if(state.active)bits|=1n<<BigInt(binding.id);if(!binding.flag)statuses.push([binding.id,state.level]);}
    statuses.sort((a,b)=>a[0]!-b[0]!);
    return{cards:{draw:draw.map(c=>c.view),hand:hand.map(c=>c.view),discard:discard.map(c=>c.view),exhaust:exhaust.map(c=>c.view)},drawn:p.drawn,discarded:p.discarded,nextUniqueId:p.nextUniqueId,
      player:{energy:resource.energy,block:resource.block,sundial:input.sundial===null?0:r.query(pileRelics.exports.sundialCount,input.sundial),statuses,bits:bits.toString()},
      counts:[live.filter(c=>r.query(cardInstances.exports.metadata,c.entity).strike).length,hand.filter(c=>c.view.id==='PAIN').length,hand.filter(c=>c.view.id==='NORMALITY').length,blood(hand),blood(draw),blood(discard)],
      shuffleRng:r.query(random.exports.current,p.shuffleRng),cardRng:r.query(random.exports.current,p.cardRng)};
  },
})}};}});
type CardSpec={id:CardId;upgraded?:boolean;misc?:number;cost?:number;costForTurn?:number;retain?:boolean;freeToPlayOnce?:boolean};
type Setup={seed:string;cardSeed:string;draw:CardSpec[];hand:CardSpec[];discard:CardSpec[];exhaust:CardSpec[];energy?:number;confused?:boolean;noDraw?:boolean;evolve?:number;darkEmbrace?:number;feelNoPain?:number;relics?:('SUNDIAL'|'THE_ABACUS')[];deck?:CardSpec[];bottles?:number[];drawPerTurn?:number};
type Step={kind:'draw';count:number}|{kind:'exhaust';index:number}|{kind:'settle'|'discardHand'|'resetCosts'|'shuffleDraw'|'shuffleDiscard'|'removeNoDraw'};
function fixture(s:Setup,steps:readonly Step[]){
  const initial=(['draw','hand','discard','exhaust'] as const).flatMap(pile=>s[pile].map(card=>({...card,pile,index:names.indexOf(card.id)}))).map((c,uniqueId)=>({...c,uniqueId}));
  const entry=defineEffect<void,unknown[]>(b=>{
    const catalog=b.local<readonly rules.EntityDefinition<CardConfig,CardSetup>[]>(),powerCatalog=b.local<readonly PowerDefinition[]>(),masters=b.local<number[]>(),owner=b.local<number>(),scope=b.local<number>(),draw=b.local<number>(),inHand=b.local<number>(),discard=b.local<number>(),exhaust=b.local<number>(),shuffle=b.local<number>(),cardRng=b.local<number>(),piles=b.local<number>(),registry=b.local<number>(),sundial=b.local<number|null>(),history=b.local<unknown[]>(),found=b.local<number|null>();
    const ids={draw,hand:inHand,discard,exhaust},view=()=>b.read(v=>({...v.get(query(views.exports.view,{piles:v.get(piles),registry:v.get(registry),sundial:v.get(sundial)})),queueSize:v.get(ruleModules.queueSize(actionQueue))}));
    return sequence(b.assign(catalog,definitions),b.assign(powerCatalog,Object.values(drawPowers.exports)),b.assign(scope,ruleModules.openScope(combatScope,0)),b.assign(owner,spawnEntity({definition:actor,owner:null,scope:0,setup:{hp:80,maxHp:80,energy:s.energy??3,block:0,gold:0}})),
      b.assign(draw,spawnEntity({definition:unbounded,owner,scope})),b.assign(inHand,spawnEntity({definition:hand,owner,scope})),b.assign(discard,spawnEntity({definition:unbounded,owner,scope})),b.assign(exhaust,spawnEntity({definition:unbounded,owner,scope})),
      b.assign(shuffle,spawnEntity({definition:stream,owner:null,scope,setup:BigInt(s.seed)})),b.assign(cardRng,spawnEntity({definition:stream,owner:null,scope,setup:BigInt(s.cardSeed)})),
      b.assign(piles,spawnEntity({definition:pileDefinition,owner,scope,setup:{actor:owner,battle:owner,draw,hand:inHand,discard,exhaust,shuffleRng:shuffle,cardRng,actionScope:scope}})),
      b.assign(registry,spawnEntity({definition:registryDefinition,owner,scope})),b.assign(sundial,null),
      ...powerBindings.flatMap((binding,i)=>{const amount=[s.noDraw?1:0,s.confused?1:0,s.evolve??0,s.darkEmbrace??0,s.feelNoPain??0][i]!;return amount===0?[]:[call(powers.exports.apply,{registry,actor:owner,definition:binding.definition,amount,source:null,debuff:false,scope})];}),
      ...(s.relics??[]).map(id=>id==='SUNDIAL'?b.assign(sundial,spawnEntity({definition:pileRelics.exports.Sundial,owner,scope:0})):spawnEntity({definition:pileRelics.exports.TheAbacus,owner,scope:0})),
      b.assign(masters,[]),forEach((s.deck??[]).map(c=>({...c,index:names.indexOf(c.id)})),item=>{const entity=b.local<number>();return sequence(
        b.assign(entity,spawnEntity({kind:cardInstances.exports.kind,definition:b.read(v=>v.get(catalog)[v.get(item).index]!),owner,scope:0,setup:{mode:0,master:null,uniqueId:-1,specialData:b.read(v=>v.get(item).misc??0),upgraded:b.read(v=>v.get(item).upgraded??false)}})),b.assign(masters,b.read(v=>[...v.get(masters),v.get(entity)])),
      );}),...(s.deck?[call(cardPiles.exports.initializeDeck,{piles,masters,bottled:b.read(v=>(s.bottles??[]).map(index=>v.get(masters)[index]!)),drawPerTurn:s.drawPerTurn??5})]:[]),
      forEach(initial,item=>{const entity=b.local<number>();return sequence(
        b.assign(entity,spawnEntity({kind:cardInstances.exports.kind,definition:b.read(v=>v.get(catalog)[v.get(item).index]!),owner,scope,setup:{mode:1,master:null,uniqueId:b.read(v=>v.get(item).uniqueId),upgraded:b.read(v=>v.get(item).upgraded??false),specialData:0}})),
        when(b.read(v=>v.get(item).cost!==undefined),call(cardInstances.exports.setCostForCombat,{entity,amount:b.read(v=>v.get(item).cost!)})),
        when(b.read(v=>v.get(item).costForTurn!==undefined),call(cardInstances.exports.overrideTurnCost,{entity,amount:b.read(v=>v.get(item).costForTurn!)})),
        call(cardInstances.exports.setFlags,{entity,retain:b.read(v=>v.get(item).retain??false),freeToPlayOnce:b.read(v=>v.get(item).freeToPlayOnce??false)}),
        call(zones.exports.move,{entity,from:null,to:b.read(v=>v.get(ids[v.get(item).pile])),index:b.read(v=>v.get(query(zones.exports.members,v.get(ids[v.get(item).pile]))).length)}),
      );}),b.assign(history,[view()]),
      ...steps.flatMap(step=>{
        const operation=step.kind==='draw'?call(cardPiles.exports.draw,{piles,count:step.count}):step.kind==='settle'?ruleModules.drainQueue(actionQueue):step.kind==='discardHand'?call(cardPiles.exports.discardHand,{piles,endTurn:true})
          :step.kind==='exhaust'?call(cardPiles.exports.exhaust,{piles,card:b.read(v=>v.get(query(zones.exports.members,v.get(inHand)))[step.index]!)})
          :step.kind==='resetCosts'?call(cardPiles.exports.resetTurnCosts,piles):step.kind==='shuffleDraw'?call(cardPiles.exports.shuffleDraw,piles):step.kind==='shuffleDiscard'?call(cardPiles.exports.shuffleDiscard,piles)
          :sequence(b.assign(found,query(powers.exports.find,{registry,actor:owner,definition:drawPowers.exports.NoDraw})),when(b.read(v=>v.get(found)!==null),call(powers.exports.remove,b.read(v=>v.get(found)!))));
        return[operation,b.assign(history,b.read(v=>[...v.get(history),v.get(view())]))];
      }),b.return(history),
    );
  });
  const wire:Record<string,unknown>={...s,relics:(s.relics??[]).map(id=>relicId[id]),steps};
  for(const pile of ['draw','hand','discard','exhaust'] as const)wire[pile]=initial.filter(c=>c.pile===pile).map(c=>({...c,id:cardId[c.id]}));
  if(s.deck)wire.deck=s.deck.map(c=>({...c,id:cardId[c.id]}));
  return{wire,definition:linkRules({id:'sts/card-piles-fixture-1',schemas:{setup:z.undefined(),result:z.array(z.unknown()),ports:{}},initialize:()=>({}),entry,definitions:[entry,noop],modules:[views]})};
}
const spec=(id:CardId,rest:Omit<CardSpec,'id'>={}):CardSpec=>({id,...rest});
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};

test('card pile continuations, composed draw/exhaust powers and relic queues match C++ at every directed boundary',async()=>{
  const cases:{setup:Omit<Setup,'seed'|'cardSeed'>;steps:Step[]}[]=[
    {setup:{draw:[spec('STRIKE_RED'),spec('BASH'),spec('DEFEND_RED')],hand:[],discard:[spec('PAIN'),spec('BLOOD_FOR_BLOOD'),spec('NORMALITY'),spec('BLOOD_FOR_BLOOD',{upgraded:true})],exhaust:[]},steps:[{kind:'draw',count:5},{kind:'settle'},{kind:'discardHand'},{kind:'draw',count:10},{kind:'settle'},{kind:'draw',count:0},{kind:'draw',count:-3},{kind:'shuffleDraw'},{kind:'shuffleDiscard'}]},
    {setup:{draw:[spec('STRIKE_RED'),spec('WOUND'),spec('VOID'),spec('WOUND'),spec('DEFEND_RED')],hand:[],discard:[spec('DAZED'),spec('STRIKE_RED'),spec('SLIMED'),spec('BASH')],exhaust:[],evolve:2,confused:true,relics:['SUNDIAL','THE_ABACUS']},steps:[{kind:'draw',count:4},{kind:'settle'},{kind:'discardHand'},{kind:'draw',count:10},{kind:'settle'},{kind:'discardHand'},{kind:'draw',count:10},{kind:'settle'},{kind:'discardHand'},{kind:'draw',count:10},{kind:'settle'}]},
    {setup:{draw:[spec('STRIKE_RED'),spec('BASH')],hand:[spec('SENTINEL',{upgraded:true}),spec('DEFEND_RED')],discard:[spec('WOUND'),spec('SENTINEL')],exhaust:[spec('BASH',{costForTurn:0})],darkEmbrace:2,feelNoPain:3,relics:['THE_ABACUS']},steps:[{kind:'exhaust',index:0},{kind:'settle'},{kind:'exhaust',index:0},{kind:'settle'},{kind:'resetCosts'},{kind:'discardHand'},{kind:'draw',count:10},{kind:'settle'}]},
    {setup:{draw:[spec('VOID'),spec('BASH',{cost:2,costForTurn:0,freeToPlayOnce:true}),spec('STRIKE_RED',{costForTurn:-9})],hand:[],discard:[spec('BLOOD_FOR_BLOOD',{cost:3,costForTurn:1})],exhaust:[spec('DEFEND_RED',{costForTurn:0})],confused:true,noDraw:true},steps:[{kind:'draw',count:20},{kind:'settle'},{kind:'removeNoDraw'},{kind:'draw',count:20},{kind:'settle'},{kind:'resetCosts'},{kind:'discardHand'},{kind:'draw',count:10},{kind:'settle'}]},
    {setup:{draw:[],hand:[],discard:[],exhaust:[]},steps:[{kind:'draw',count:10},{kind:'settle'},{kind:'shuffleDraw'},{kind:'shuffleDiscard'}]},
    {setup:{draw:[],hand:[],discard:[],exhaust:[],deck:[spec('STRIKE_RED'),spec('DEFEND_RED'),spec('ASCENDERS_BANE'),spec('BASH'),spec('SEARING_BLOW',{upgraded:true,misc:5}),spec('RITUAL_DAGGER',{misc:42}),spec('BATTLE_TRANCE')],bottles:[3,6]},steps:[{kind:'draw',count:5},{kind:'settle'},{kind:'discardHand'},{kind:'draw',count:10},{kind:'settle'}]},
    {setup:{draw:[],hand:[],discard:[],exhaust:[],deck:[spec('STRIKE_RED'),...Array.from({length:7},()=>spec('DRAMATIC_ENTRANCE')),spec('BASH')],bottles:[0,8],drawPerTurn:5},steps:[{kind:'draw',count:5},{kind:'settle'},{kind:'draw',count:5},{kind:'settle'}]},
    {setup:{draw:[],hand:[],discard:[],exhaust:[],deck:[]},steps:[{kind:'draw',count:5},{kind:'settle'}]},
  ];
  const reference=await ReferenceClient.create();
  try{for(const seed of ['0','130','18446744073709551615'])for(const [index,c] of cases.entries()){
    const {wire,definition}=fixture({...c.setup,seed,cardSeed:seed},c.steps),expected=await reference.call({op:'pile-case',...wire});
    for(const controlled of [false,true]){
      const loaded=unwrap(await createCardLoader({controlled}).load(definition)),instance=unwrap(await loaded.core.start(undefined));
      try{const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Expected completed pile case');assertSameState(expected,stop.result,`piles seed=${seed} case=${index} controlled=${controlled}`);}
      finally{await instance.close();if(loaded.capture)await loaded.capture.release(instance.id);}
    }
  }}finally{await reference.close();}
});
