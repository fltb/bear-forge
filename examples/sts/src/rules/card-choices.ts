import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {battles} from './battles.ts';
import {cardInstances} from './card-instances.ts';
import {entityId} from './resources.schemas.ts';
import type {CardChoicePlayer,PendingCardChoice,CardChoiceInput,CardManyInput,CardChoiceExports,CardSelection} from './card-choices.types.ts';
const {defineRules,defineComponent,defineEvent,defineQuery,defineEffect,defineEntity,sequence,when,call,query,spawnEntity,despawnEntity,chooseOne,chooseMany}=rules;
const playerSchema=z.object({battle:entityId,screen:z.int32().nonnegative(),skipIndex:z.int32().nonnegative().optional(),indices:z.array(z.int32().nonnegative()).optional()});
const pendingSchema=playerSchema.extend({cards:z.array(entityId),minimum:z.int32().nonnegative().optional(),maximum:z.int32().nonnegative().optional(),multiple:z.boolean().optional()}).strict();
const chosenSchema=playerSchema.extend({card:entityId,index:z.int32().nonnegative(),interactive:z.boolean()});
const selectedSchema=playerSchema.extend({cards:z.array(entityId),selectedIndices:z.array(z.int32().nonnegative()),interactive:z.boolean(),bits:z.number().int().nonnegative()});

/** Choice cardinality and suspended selection data are generic; callers supply presentation and wire indices. */
export function createCardChoices<W,R>(adapter:rules.ChoiceAdapter<number,CardChoicePlayer,W,R>,requires:readonly rules.RuleModule<unknown>[]):rules.RuleModule<CardChoiceExports>{
  return defineRules({requires:[battles,...requires],build(m){
    const state=m.own(defineComponent({schema:pendingSchema.nullable(),initial:()=>null}));
    const chosen=m.own(defineEvent({payload:chosenSchema,dispatch:'immediate'})),selected=m.own(defineEvent({payload:selectedSchema,dispatch:'immediate'})),requesting=m.own(defineEvent({payload:pendingSchema,dispatch:'immediate'}));
    const beforeRequest=m.atom({input:pendingSchema,output:z.undefined(),reads:[],writes:[],emits:[requesting],run(_r,payload){return{writes:[],events:[{event:requesting,payload}],result:undefined};}});
    const announce=m.atom({input:chosenSchema,output:z.undefined(),reads:[],writes:[],emits:[chosen],run(_r,payload){return{writes:[],events:[{event:chosen,payload}],result:undefined};}});
    const announceSelected=m.atom({input:selectedSchema,output:z.undefined(),reads:[],writes:[],emits:[selected],run(_r,payload){return{writes:[],events:[{event:selected,payload}],result:undefined};}});
    const save=m.atom({input:z.object({entity:entityId,value:pendingSchema}),output:z.undefined(),reads:[],writes:[state],emits:[],run(_r,i){return{writes:[{entity:i.entity,component:state,value:i.value}],events:[],result:undefined};}});
    const kind=m.kind({config:z.undefined(),setup:pendingSchema,components:[state],initialize:defineEffect<rules.EntityLifecycle<PendingCardChoice>,void>(b=>call(save,{entity:b.read(v=>v.input.entity),value:b.read(v=>v.input.setup)}))});
    const selection=defineEntity(kind,undefined);
    const pending=defineQuery({input:entityId,output:pendingSchema.nullable(),reads:[state],base:(r,battle)=>{const matches=r.entities(state).map(entity=>r.component(entity,state)).filter((value):value is PendingCardChoice=>value!==null&&value.battle===battle);if(matches.length>1)throw Error('Multiple current card selections for one battle');return matches[0]??null;}});
    const validate=defineQuery({input:pendingSchema,output:pendingSchema,dependencies:[cardInstances.exports.current],base:(r,input)=>{if(new Set(input.cards).size!==input.cards.length)throw Error('Card choices require distinct entity identities');if(input.indices&&(input.indices.length!==input.cards.length||new Set(input.indices).size!==input.indices.length))throw Error('Choice wire indices must be a bijection');if(input.skipIndex!==undefined&&(input.indices??input.cards.map((_,i)=>i)).includes(input.skipIndex))throw Error('Choice skip index overlaps a candidate');for(const card of input.cards)r.query(cardInstances.exports.current,card);return{...input,indices:input.indices??input.cards.map((_,index)=>index)};}});
    const open=defineEffect<PendingCardChoice,number>(b=>{const entity=b.local<number>();return sequence(when(b.read(v=>v.query(pending,v.input.battle)!==null),b.return(b.read(()=>{throw Error('A card selection is already pending');}))),b.assign(entity,spawnEntity({definition:selection,owner:b.read(v=>v.input.battle),scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),setup:b.input})),call(beforeRequest,b.input),b.return(entity));});
    const one=defineEffect<CardChoiceInput,number|null>(b=>{const input=b.local<PendingCardChoice>(),entity=b.local<number|null>(),answer=b.local<rules.ChoiceResult<number>>();return sequence(
      b.assign(input,query(validate,b.read(v=>({...v.input,cards:[...v.input.cards]})))),b.assign(entity,null),when(b.read(v=>v.get(input).cards.length>1||v.input.skipIndex!==undefined),b.assign(entity,call(open,input))),
      when(b.read(v=>v.input.skipIndex!==undefined),b.assign(answer,chooseOne({adapter,player:b.read(v=>({battle:v.input.battle,screen:v.input.screen,indices:v.get(input).indices,skipIndex:v.input.skipIndex})),candidates:b.read(v=>v.get(input).cards),allowSkip:true,empty:'request',singleton:'request'})),b.assign(answer,chooseOne({adapter,player:b.read(v=>({battle:v.input.battle,screen:v.input.screen,indices:v.get(input).indices})),candidates:b.read(v=>v.get(input).cards),allowSkip:false,empty:'skip',singleton:'automatic'}))),
      when(b.read(v=>v.get(entity)!==null),despawnEntity({entity:b.read(v=>v.get(entity)!),reason:{choiceAnswered:true}})),when(b.read(v=>v.get(answer).kind==='skipped'),sequence(when(b.read(v=>v.input.skipIndex!==undefined),call(announceSelected,b.read(v=>({battle:v.input.battle,screen:v.input.screen,cards:[],selectedIndices:[],interactive:true,bits:((2<<29)|v.input.skipIndex!)>>>0})))),b.return(null))),
      call(announce,b.read(v=>{const a=v.get(answer);if(a.kind!=='selected')throw Error('Missing card selection');return{battle:v.input.battle,screen:v.input.screen,card:a.value,index:v.get(input).indices![v.get(input).cards.indexOf(a.value)]!,interactive:v.get(input).cards.length>1||v.input.skipIndex!==undefined};})),
      call(announceSelected,b.read(v=>{const a=v.get(answer);if(a.kind!=='selected')throw Error('Missing card selection');const index=v.get(input).indices![v.get(input).cards.indexOf(a.value)]!;return{battle:v.input.battle,screen:v.input.screen,cards:[a.value],selectedIndices:[index],interactive:v.get(input).cards.length>1||v.input.skipIndex!==undefined,bits:((2<<29)|index)>>>0};})),
      b.return(b.read(v=>{const a=v.get(answer);return a.kind==='selected'?a.value:null;})),
    );});
    const many=defineEffect<CardManyInput,readonly number[]>(b=>{const input=b.local<PendingCardChoice>(),entity=b.local<number>(),answer=b.local<readonly number[]>();return sequence(
      b.assign(input,query(validate,b.read(v=>({...v.input,cards:[...v.input.cards],multiple:true})))),b.assign(entity,call(open,input)),
      b.assign(answer,chooseMany({adapter,player:b.read(v=>({battle:v.input.battle,screen:v.input.screen,indices:v.get(input).indices})),candidates:b.read(v=>v.get(input).cards),min:b.read(v=>v.input.minimum),max:b.read(v=>Math.min(v.input.maximum,v.get(input).cards.length)),order:'irrelevant',empty:'request',singleton:'request'})),
      despawnEntity({entity,reason:{choiceAnswered:true}}),call(announceSelected,b.read(v=>{const indices=v.get(answer).map(card=>v.get(input).indices![v.get(input).cards.indexOf(card)]!);return{battle:v.input.battle,screen:v.input.screen,cards:[...v.get(answer)],selectedIndices:indices,interactive:true,bits:((3<<29)|indices.reduce((mask,index)=>mask|(1<<index),0))>>>0};})),b.return(answer),
    );});
    return{exports:{one,many,pending,chosen:chosen.public,selected:selected.public,requesting:requesting.public}};
  }});
}
