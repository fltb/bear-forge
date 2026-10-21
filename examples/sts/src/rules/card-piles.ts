import {componentPart,projectFields} from './component-parts.ts';
import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import type {ruleModules} from '@bear-forge/card-engine';
import {zones} from './zones.ts';
import {random} from './random.ts';
import {resources} from './resources.ts';
import {cardInstances} from './card-instances.ts';
import {actionQueue,combatScope} from './combat-actions.ts';
import {entityId} from './resources.schemas.ts';
import {cardPilesSetupSchema,cardPilesStateSchema,pileCardSchema,cardDiscardSchema,pileBindingsSchema,pileCountersSchema,pileMembershipSchema} from './card-piles.schemas.ts';
import type {CardPilesSetup,CardPilesState,PileCard,CardDiscard} from './card-piles.types.ts';
import type {CardConfig,CardSetup,CardMutable} from './card-instances.types.ts';
const {defineRules,defineComponent,defineEvent,defineQuery,defineEffect,sequence,when,call,query,forEach,enqueue}=rules;

/** Ordered card movement and draw continuations. Named card, power and relic behavior is content. */
export const cardPiles=defineRules({requires:[zones,random,resources,cardInstances],build(m){
  const bindings=componentPart(m,pileBindingsSchema),counters=componentPart(m,pileCountersSchema),membership=componentPart(m,pileMembershipSchema);
  const pickBindings=projectFields(pileBindingsSchema),pickCounters=projectFields(pileCountersSchema),pickMembership=projectFields(pileMembershipSchema);
  const relic={},power={},card={},after={},stages={relic,power,card,after};
  const order={phases:[{phase:relic,before:[power]},{phase:power,before:[card]},{phase:card,before:[after]},{phase:after}],default:power};
  const drawing=m.own(defineEvent({payload:pileCardSchema,dispatch:'immediate',order}));
  const drawn=m.own(defineEvent({payload:pileCardSchema,dispatch:'immediate',order}));
  const enteringHand=m.own(defineEvent({payload:pileCardSchema,dispatch:'immediate',order}));
  const shuffling=m.own(defineEvent({payload:entityId,dispatch:'immediate',order}));
  const exhausting=m.own(defineEvent({payload:pileCardSchema,dispatch:'immediate',order}));
  const exhausted=m.own(defineEvent({payload:pileCardSchema,dispatch:'immediate',order}));
  const discarded=m.own(defineEvent({payload:cardDiscardSchema,dispatch:'immediate',order}));
  const current=defineQuery({input:entityId,output:cardPilesStateSchema,dependencies:[bindings.current,counters.current,membership.current],base:(r,id)=>({...r.query(bindings.current,id),...r.query(counters.current,id),...r.query(membership.current,id)})});
  const validated=defineQuery({input:cardPilesStateSchema,output:cardPilesStateSchema,dependencies:[zones.exports.members,zones.exports.capacity,random.exports.current,resources.exports.current],base:(r,value)=>{
    const ids=[value.draw,value.hand,value.discard,value.exhaust];if(new Set(ids).size!==ids.length)throw Error('Card piles must be distinct zones');
    for(const zone of ids)r.query(zones.exports.members,zone);
    if(r.query(zones.exports.capacity,value.hand)!==10)throw Error('The STS hand must have capacity ten');
    for(const zone of [value.draw,value.discard,value.exhaust])if(r.query(zones.exports.capacity,zone)!==null)throw Error('Other combat piles must be unbounded');
    r.query(random.exports.current,value.shuffleRng);r.query(random.exports.current,value.cardRng);r.query(resources.exports.current,value.actor);return value;
  }});
  const initializeState=m.atom({input:z.object({entity:entityId,value:cardPilesStateSchema}),output:z.undefined(),reads:[],writes:[bindings.component,counters.component,membership.component],emits:[],run(_r,i){return{writes:[{entity:i.entity,component:bindings.component,value:pickBindings(i.value)},{entity:i.entity,component:counters.component,value:pickCounters(i.value)},{entity:i.entity,component:membership.component,value:pickMembership(i.value)}],events:[],result:undefined};}});
  const initialize=defineEffect<rules.EntityLifecycle<CardPilesSetup>,void>(b=>call(initializeState,{entity:b.read(v=>v.input.entity),value:query(validated,b.read(v=>({...v.input.setup,scope:v.input.scope,drawn:0,discarded:0,initialized:false,nextUniqueId:0,registered:[],auxiliary:[]})))}));
  const kind=m.kind({config:z.undefined(),setup:cardPilesSetupSchema,components:[bindings.component,counters.component,membership.component],initialize});
  const canDraw=defineQuery({input:entityId,output:z.boolean(),base:()=>true});
  function announce<T>(schema:rules.Schema<T>,event:ruleModules.Owned<rules.RuleEvent<T>>):rules.Effect<T,void>{
    return m.atom({input:schema,output:z.undefined(),reads:[],writes:[],emits:[event],run(_r,payload){return{writes:[],events:[{event,payload}],result:undefined};}});
  }
  const announceDrawing=announce(pileCardSchema,drawing),announceDrawn=announce(pileCardSchema,drawn),announceEntering=announce(pileCardSchema,enteringHand),announceShuffle=announce(entityId,shuffling),announceExhausting=announce(pileCardSchema,exhausting),announceExhausted=announce(pileCardSchema,exhausted);
  const addDrawn=m.atom({input:z.object({piles:entityId,count:z.int32().nonnegative()}),output:z.undefined(),reads:[counters.component],writes:[counters.component],emits:[],run(r,i){const value=r.component(i.piles,counters.component);if(value===null)throw Error('Uninitialized card piles');return{writes:[{entity:i.piles,component:counters.component,value:{...value,drawn:(value.drawn+i.count)|0}}],events:[],result:undefined};}});
  const countDiscard=m.atom({input:cardDiscardSchema,output:z.undefined(),reads:[counters.component],writes:[counters.component],emits:[discarded],run(r,i){const value=r.component(i.piles,counters.component);if(value===null)throw Error('Uninitialized card piles');return{writes:[{entity:i.piles,component:counters.component,value:{...value,discarded:(value.discarded+Number(i.endTurn))|0}}],events:[{event:discarded,payload:i}],result:undefined};}});
  const resetDiscardCount=m.atom({input:entityId,output:z.undefined(),reads:[counters.component],writes:[counters.component],emits:[],run(r,entity){const value=r.component(entity,counters.component);if(value===null)throw Error('Uninitialized card piles');return{writes:[{entity,component:counters.component,value:{...value,discarded:0}}],events:[],result:undefined};}});
  const setActionScope=m.atom({input:z.object({piles:entityId,scope:z.int32().nonnegative()}),output:z.undefined(),reads:[bindings.component],writes:[bindings.component],emits:[],run(r,i){const value=r.component(i.piles,bindings.component);if(value===null)throw Error('Uninitialized card piles');return{writes:[{entity:i.piles,component:bindings.component,value:{...value,actionScope:i.scope}}],events:[],result:undefined};}});
  const register=m.atom({input:pileCardSchema,output:z.undefined(),reads:[membership.component],writes:[membership.component],emits:[],run(r,i){const s=r.component(i.piles,membership.component);if(s===null||s.registered.includes(i.card))throw Error('Combat card is already registered');return{writes:[{entity:i.piles,component:membership.component,value:{...s,registered:[...s.registered,i.card]}}],events:[],result:undefined};}});
  const unregister=m.atom({input:pileCardSchema,output:z.undefined(),reads:[membership.component],writes:[membership.component],emits:[],run(r,i){const s=r.component(i.piles,membership.component);if(s===null)throw Error('Missing card piles');return{writes:[{entity:i.piles,component:membership.component,value:{...s,registered:s.registered.filter(card=>card!==i.card)}}],events:[],result:undefined};}});
  const attachZone=m.atom({input:z.object({piles:entityId,zone:entityId}),output:z.undefined(),reads:[bindings.component,membership.component],writes:[membership.component],emits:[],run(r,i){const s=r.component(i.piles,membership.component),p=r.component(i.piles,bindings.component);if(s===null||p===null||[p.draw,p.hand,p.discard,p.exhaust,...s.auxiliary].includes(i.zone))throw Error('Zone is already attached to these card piles');return{writes:[{entity:i.piles,component:membership.component,value:{...s,auxiliary:[...s.auxiliary,i.zone]}}],events:[],result:undefined};}});
  const requireMove=defineEffect<{entity:number;from:number|null;to:number|null;index:number},void>(b=>{const moved=b.local<boolean>();return sequence(b.assign(moved,call(zones.exports.move,b.input)),b.return(b.read(v=>{if(!v.get(moved))throw Error('A required card movement was canceled');return undefined;})));});
  const requireDetached=defineEffect<number,void>(b=>b.return(b.read(v=>{if(v.query(zones.exports.location,v.input)!==null)throw Error('A card movement hook must leave its card detached');return undefined;})));
  const detach=defineEffect<PileCard,void>(b=>{const location=b.local<number|null>();return sequence(
    b.assign(location,b.read(v=>{
      const p=v.query(bindings.current,v.input.piles),c=v.query(cardInstances.exports.current,v.input.card),location=v.query(zones.exports.location,v.input.card);
      if(c.mode!==1)throw Error('Combat piles only accept combat instances');
      if(location!==null&&![p.draw,p.hand,p.discard].includes(location))throw Error('Card is outside the live combat piles');return location;
    })),when(b.read(v=>v.get(location)!==null),call(requireMove,{entity:b.read(v=>v.input.card),from:location,to:null,index:0})),
  );});
  const moveToHand=defineEffect<PileCard,void>(b=>{const p=b.local<CardPilesState>(),to=b.local<number>();return sequence(
    b.assign(p,query(current,b.read(v=>v.input.piles))),call(detach,b.input),
    when(b.read(v=>v.query(zones.exports.members,v.get(p).hand).length<10),call(announceEntering,b.input)),call(requireDetached,b.read(v=>v.input.card)),
    b.assign(to,b.read(v=>v.query(zones.exports.members,v.get(p).hand).length<10?v.get(p).hand:v.get(p).discard)),
    call(requireMove,{entity:b.read(v=>v.input.card),from:null,to,index:b.read(v=>v.query(zones.exports.members,v.get(to)).length)}),
  );});
  const discard=defineEffect<CardDiscard,void>(b=>{const p=b.local<CardPilesState>();return sequence(
    b.assign(p,query(current,b.read(v=>v.input.piles))),call(detach,{piles:b.read(v=>v.input.piles),card:b.read(v=>v.input.card)}),
    call(requireMove,{entity:b.read(v=>v.input.card),from:null,to:b.read(v=>v.get(p).discard),index:b.read(v=>v.query(zones.exports.members,v.get(p).discard).length)}),call(countDiscard,b.input),
  );});
  const exhaust=defineEffect<PileCard,void>(b=>{const p=b.local<CardPilesState>();return sequence(
    b.assign(p,query(current,b.read(v=>v.input.piles))),call(detach,b.input),call(announceExhausting,b.input),call(requireDetached,b.read(v=>v.input.card)),
    call(requireMove,{entity:b.read(v=>v.input.card),from:null,to:b.read(v=>v.get(p).exhaust),index:b.read(v=>v.query(zones.exports.members,v.get(p).exhaust).length)}),call(unregister,b.input),call(announceExhausted,b.input),
  );});
  const shuffleDiscard=defineEffect<number,void>(b=>{const p=b.local<CardPilesState>(),order=b.local<readonly number[]>();return sequence(
    b.assign(p,query(current,b.input)),b.assign(order,random.exports.shuffle({stream:b.read(v=>v.get(p).shuffleRng),items:query(zones.exports.members,b.read(v=>v.get(p).discard))})),
    call(zones.exports.reorder,{zone:b.read(v=>v.get(p).discard),order:b.read(v=>[...v.get(order)])}),
    forEach(order,card=>call(requireMove,{entity:card,from:b.read(v=>v.get(p).discard),to:b.read(v=>v.get(p).draw),index:b.read(v=>v.query(zones.exports.members,v.get(p).draw).length)})),
  );});
  const shuffleDraw=defineEffect<number,void>(b=>{const p=b.local<CardPilesState>(),order=b.local<readonly number[]>();return sequence(
    b.assign(p,query(current,b.input)),b.assign(order,random.exports.shuffle({stream:b.read(v=>v.get(p).shuffleRng),items:query(zones.exports.members,b.read(v=>v.get(p).draw))})),call(zones.exports.reorder,{zone:b.read(v=>v.get(p).draw),order:b.read(v=>[...v.get(order)])}),
  );});
  const drawPlan=defineQuery({input:z.object({piles:entityId,count:z.int32()}).strict(),output:z.object({piles:cardPilesStateSchema,amount:z.int32().nonnegative(),available:z.int32().nonnegative()}),dependencies:[current,canDraw,zones.exports.members],base:(r,input)=>{
    const p=r.query(current,input.piles),available=r.query(zones.exports.members,p.draw).length,hand=r.query(zones.exports.members,p.hand).length;
    const blocked=input.count<=0||!r.query(canDraw,input.piles)||hand>=10||available+r.query(zones.exports.members,p.discard).length===0;
    return{piles:p,amount:blocked?0:Math.min(10-hand,input.count),available};
  }});
  const draw:rules.Effect<{piles:number;count:number},void>=defineEffect(b=>{
    const p=b.local<CardPilesState>(),amount=b.local<number>(),available=b.local<number>(),picked=b.local<number>(),plan=b.local<{piles:CardPilesState;amount:number;available:number}>();
    return sequence(b.assign(plan,query(drawPlan,b.input)),b.assign(p,b.read(v=>v.get(plan).piles)),b.assign(amount,b.read(v=>v.get(plan).amount)),b.assign(available,b.read(v=>v.get(plan).available)),
      when(b.read(v=>v.get(amount)===0),b.return(undefined)),
      when(b.read(v=>v.get(available)<v.get(amount)),sequence(
        enqueue(draw,{piles:b.read(v=>v.input.piles),count:b.read(v=>v.get(amount)-v.get(available))},{queue:actionQueue,position:'front',source:b.read(v=>v.input.piles),lifetime:b.read(v=>v.get(p).actionScope)}),
        call(announceShuffle,b.read(v=>v.input.piles)),enqueue(shuffleDiscard,b.read(v=>v.input.piles),{queue:actionQueue,position:'front',source:b.read(v=>v.input.piles),lifetime:b.read(v=>v.get(p).actionScope)}),
        when(b.read(v=>v.get(available)>0),call(draw,{piles:b.read(v=>v.input.piles),count:available})),b.return(undefined),
      )),call(addDrawn,{piles:b.read(v=>v.input.piles),count:amount}),
      forEach(b.read(v=>Array.from({length:v.get(amount)},(_,i)=>i)),()=>sequence(
        b.assign(picked,b.read(v=>{const cards=v.query(zones.exports.members,v.get(p).draw),last=cards.at(-1);if(last===undefined)throw Error('A draw hook emptied the active draw batch');return last;})),
        call(requireMove,{entity:picked,from:b.read(v=>v.get(p).draw),to:null,index:0}),call(announceDrawing,{piles:b.read(v=>v.input.piles),card:picked}),
        call(requireDetached,picked),call(moveToHand,{piles:b.read(v=>v.input.piles),card:picked}),call(announceDrawn,{piles:b.read(v=>v.input.piles),card:picked}),
      )),
    );
  });
  const discardHand=defineEffect<{piles:number;endTurn:boolean},void>(b=>forEach(b.read(v=>[...v.query(zones.exports.members,v.query(bindings.current,v.input.piles).hand)].reverse()),card=>call(discard,{piles:b.read(v=>v.input.piles),card,endTurn:b.read(v=>v.input.endTurn)})));
  const deckPlan=defineQuery({input:z.object({piles:entityId,masters:z.array(entityId).max(96).readonly(),bottled:z.array(entityId).max(3).readonly(),drawPerTurn:z.int32().nonnegative()}).strict(),output:z.object({piles:cardPilesStateSchema,innate:z.array(z.boolean())}),dependencies:[current,zones.exports.members,cardInstances.exports.current,cardInstances.exports.variant],base:(r,input)=>{
    const p=r.query(current,input.piles);
    if(p.initialized||[p.draw,p.hand,p.discard,p.exhaust].some(zone=>r.query(zones.exports.members,zone).length!==0))throw Error('A combat deck can only be initialized once into empty piles');
    if(new Set(input.masters).size!==input.masters.length||input.bottled.some(card=>!input.masters.includes(card)))throw Error('Invalid permanent deck identities or bottle references');
    const innate=input.masters.map(master=>{if(r.query(cardInstances.exports.current,master).mode!==0)throw Error('A battle deck requires permanent masters');return input.bottled.includes(master)||r.query(cardInstances.exports.variant,master).innate;});
    return{piles:p,innate};
  }});
  const beginDeck=m.atom({input:z.object({piles:entityId,count:z.int32().nonnegative()}),output:z.undefined(),reads:[counters.component],writes:[counters.component],emits:[],run(r,i){const value=r.component(i.piles,counters.component);if(value===null||value.initialized)throw Error('A combat deck is already initializing');return{writes:[{entity:i.piles,component:counters.component,value:{...value,initialized:true,nextUniqueId:i.count}}],events:[],result:undefined};}});
  const initializeDeck=defineEffect<{piles:number;masters:readonly number[];bottled:readonly number[];drawPerTurn:number},void>(b=>{
    const plan=b.local<{piles:CardPilesState;innate:boolean[]}>(),order=b.local<readonly number[]>(),made=b.local<number>();
    return sequence(b.assign(plan,query(deckPlan,b.input)),call(beginDeck,{piles:b.read(v=>v.input.piles),count:b.read(v=>v.input.masters.length)}),
      b.assign(order,random.exports.shuffle({stream:b.read(v=>v.get(plan).piles.shuffleRng),items:b.read(v=>v.input.masters.map((_,i)=>i))})),
      b.assign(order,b.read(v=>[...v.get(order).filter(i=>!v.get(plan).innate[i]),...v.get(order).filter(i=>v.get(plan).innate[i])])),
      forEach(order,index=>sequence(b.assign(made,cardInstances.exports.copyIntoCombat({master:b.read(v=>v.input.masters[v.get(index)]!),uniqueId:index,owner:b.read(v=>v.get(plan).piles.actor),scope:b.read(v=>v.get(plan).piles.scope)})),
        call(register,{piles:b.read(v=>v.input.piles),card:made}),call(requireMove,{entity:made,from:null,to:b.read(v=>v.get(plan).piles.draw),index:b.read(v=>v.query(zones.exports.members,v.get(plan).piles.draw).length)}),
      )),when(b.read(v=>v.get(plan).innate.filter(Boolean).length>v.input.drawPerTurn),enqueue(draw,{piles:b.read(v=>v.input.piles),count:b.read(v=>v.get(plan).innate.filter(Boolean).length-v.input.drawPerTurn)},
        {queue:actionQueue,source:b.read(v=>v.input.piles),lifetime:b.read(v=>v.get(plan).piles.actionScope)})),
    );
  });
  const resetTurnCosts=defineEffect<number,void>(b=>forEach(b.read(v=>{const p=v.query(bindings.current,v.input);return[p.hand,p.discard,p.draw];}),zone=>forEach(query(zones.exports.members,zone),card=>call(cardInstances.exports.resetTurn,{entity:card}))));
  const nextId=m.atom({input:entityId,output:z.int32(),reads:[counters.component],writes:[counters.component],emits:[],run(r,piles){const s=r.component(piles,counters.component);if(s===null||!s.initialized)throw Error('Combat deck has not been initialized');return{writes:[{entity:piles,component:counters.component,value:{...s,nextUniqueId:(s.nextUniqueId+1)|0}}],events:[],result:(s.nextUniqueId<<16)>>16};}});
  const create=defineEffect<{piles:number;definition:rules.EntityDefinition<CardConfig,CardSetup>;upgraded:boolean;specialData:number;destination:0|1|2|3;shuffle:boolean;mutable:CardMutable|null},number>(b=>{const p=b.local<CardPilesState>(),id=b.local<number>(),entity=b.local<number>(),index=b.local<number>();return sequence(
    b.assign(p,query(current,b.read(v=>v.input.piles))),b.assign(id,call(nextId,b.read(v=>v.input.piles))),b.assign(entity,rules.spawnEntity({kind:cardInstances.exports.kind,definition:b.read(v=>v.input.definition),owner:b.read(v=>v.get(p).actor),scope:b.read(v=>v.get(p).scope),setup:{mode:1,master:null,uniqueId:id,upgraded:b.read(v=>v.input.upgraded),specialData:b.read(v=>v.input.specialData)}})),
    call(register,{piles:b.read(v=>v.input.piles),card:entity}),when(b.read(v=>v.input.mutable!==null),call(cardInstances.exports.setMutable,{entity,value:b.read(v=>{const c=v.input.mutable!;return{specialData:c.specialData,cost:c.cost,costForTurn:c.costForTurn,upgraded:c.upgraded,freeToPlayOnce:c.freeToPlayOnce,retain:c.retain};})})),
    when(b.read(v=>v.input.destination===1),call(moveToHand,{piles:b.read(v=>v.input.piles),card:entity}),
      when(b.read(v=>v.input.destination===3),call(exhaust,{piles:b.read(v=>v.input.piles),card:entity}),sequence(
        b.assign(index,b.read(v=>v.query(zones.exports.members,v.input.destination===0?v.get(p).draw:v.get(p).discard).length)),
        when(b.read(v=>v.input.destination===0&&v.input.shuffle&&v.get(index)>0),b.assign(index,call(random.exports.int,{stream:b.read(v=>v.get(p).cardRng),start:0,end:b.read(v=>v.get(index)-1)}))),
        call(requireMove,{entity,from:null,to:b.read(v=>v.input.destination===0?v.get(p).draw:v.get(p).discard),index}),
      ))),b.return(entity),
  );});
  const inScope=defineQuery({input:z.int32().nonnegative(),output:z.array(entityId),reads:[bindings.component],base:(r,scope)=>r.entities(bindings.component).filter(id=>r.component(id,bindings.component)?.scope===scope)});
  m.lifecycle(combatScope,{dispose:defineEffect<rules.ScopeLifecycle,void>(b=>forEach(query(inScope,b.read(v=>v.input.scope)),id=>forEach(b.read(v=>{const p=v.query(current,v.get(id));return[p.hand,p.draw,p.discard,p.exhaust,...p.auxiliary];}),zone=>forEach(query(zones.exports.members,zone),entity=>call(requireMove,{entity,from:zone,to:null,index:0})))))});
  return{exports:{bindings:bindings.current,counters:counters.current,membership:membership.current,kind,current,allocateIdentity:nextId,attachZone,register,unregister,announceShuffle,canDraw,initializeDeck,create,draw,moveToHand,discard,discardHand,exhaust,shuffleDiscard,shuffleDraw,resetTurnCosts,resetDiscardCount,setActionScope,
    drawing:drawing.public,drawn:drawn.public,enteringHand:enteringHand.public,shuffling:shuffling.public,exhausting:exhausting.public,exhausted:exhausted.public,discarded:discarded.public,stages}};
}});
