import type {CardUse} from '../rules/card-instances.types.ts';
import { typedValue } from '../rules/value.schemas.ts';
import {combatSessions} from "../rules/combat-sessions.ts";
import {CardScreen} from "./selection-presentations.ts";
import {z} from 'zod';
import {rules} from '../rules/execution.ts';
import {ruleModules} from '@bear-forge/card-engine';
import {FrameSchema,ActionSchema,type Action,type GameEvent} from "../game.schemas.ts";
import {adventures} from "../rules/adventures.ts";
import {battles} from "../rules/battles.ts";
import {createAdventureChoices} from "../rules/adventure-choices.ts";
import {createCardChoices} from "../rules/card-choices.ts";
import {createCombatSelectionUtils} from "../content/cards/shared/selection-utils.ts";
import {battlePublications} from "./battle-publications.ts";
import {adventureViews} from "./adventure-views.ts";
import {combatViews} from "./combat-views.ts";
import type {CardChoicePlayer,CardSelection,PendingCardChoice} from "../rules/card-choices.types.ts";

const {defineRules,defineQuery,defineEffect,sequence,when,call,query,on,install}=rules;
const booleanChoiceBits=(value:boolean)=>((2<<29)|(value?0:1))>>>0;
const selectionSchema=z.object({screen:z.number(),cards:z.array(z.number()),indices:z.array(z.number()).optional(),skipIndex:z.number().optional(),pickCount:z.number().optional(),canPickZero:z.boolean().optional(),canPickAnyNumber:z.boolean().optional()}).nullable();
const projections=defineRules({requires:[adventureViews,combatViews,battlePublications],build(){
  const frame=defineQuery({input:z.object({run:z.number(),actions:z.array(z.number()),selection:selectionSchema}),output:FrameSchema,dependencies:[adventureViews.exports.game,combatViews.exports.battle,adventures.exports.current,battlePublications.exports.forRun,adventures.exports.historyStatus],base(r,i){
    const s=r.query(adventures.exports.historyStatus,i.run),live=r.query(adventureViews.exports.game,i.run),entry=r.query(battlePublications.exports.forRun,i.run);return{game:entry?{...entry,hp:live.hp,maxHp:live.maxHp,gold:live.gold,potions:live.potions}:live,battle:r.query(combatViews.exports.battle,{run:i.run,selection:i.selection,actions:i.actions}),actions:i.actions.map(bits=>({bits})),decisions:s.history.length,history:s.history,heartDefeated:s.outcome===2&&s.act===4};
  }});
  const adventure=defineQuery({input:typedValue<rules.ChoiceRequest<number,number>>(),output:FrameSchema,dependencies:[frame],base:(r,i)=>r.query(frame,{run:i.player,actions:[...i.candidates],selection:null})});
  const combat=defineQuery({input:typedValue<rules.ChoiceRequest<number,CardChoicePlayer>>(),output:FrameSchema,dependencies:[frame,battles.exports.current,adventures.exports.forActor,battles.exports.status],base(r,i){
    const run=r.query(adventures.exports.forActor,r.query(battles.exports.status,i.player.battle).actor);if(run===null)throw Error('Card choice has no adventure');const indices=i.player.indices??i.candidates.map((_,index)=>index),actions:number[]=[];if(i.kind==='one'){for(const index of indices)actions.push(((2<<29)|index)>>>0);if(i.allowSkip&&i.player.skipIndex!==undefined)actions.push(((2<<29)|i.player.skipIndex)>>>0);}else{for(let mask=0;mask<(1<<indices.length);mask++){const picked=indices.filter((_,index)=>mask&(1<<index));if(picked.length>=i.min&&picked.length<=i.max)actions.push(((3<<29)|picked.reduce((bits,index)=>bits|(1<<index),0))>>>0);}}return r.query(frame,{run,actions,selection:{screen:i.player.screen,cards:[...i.candidates],indices:[...indices],...(i.allowSkip&&i.player.skipIndex!==undefined?{skipIndex:i.player.skipIndex}:{}),pickCount:i.kind==='one'?1:i.max,canPickZero:i.kind==='one'?i.allowSkip:i.min===0,canPickAnyNumber:i.kind==='many'&&i.min===0&&i.max>=i.candidates.length}});
  }});
  const booleanCombat=defineQuery({input:typedValue<rules.ChoiceRequest<boolean,CardUse>>(),output:FrameSchema,dependencies:[frame,adventures.exports.forActor],base(r,i){
    const run=r.query(adventures.exports.forActor,i.player.owner);if(run===null)throw Error('Boolean card choice has no adventure');
    return r.query(frame,{run,actions:i.candidates.map(value=>booleanChoiceBits(value)),selection:{screen:CardScreen.OptionalEngage,cards:[],pickCount:1,canPickZero:false,canPickAnyNumber:false}});
  }});
  return{exports:{frame,adventure,combat,booleanCombat}};
}});

const adventureAdapter=ruleModules.choicePort({port:'decision',request:projections.exports.adventure,reply:ActionSchema,decode:(request,reply:Action)=>({kind:'selected' as const,indices:[request.candidates.indexOf(reply.bits)]})});
const combatAdapter=ruleModules.choicePort({port:'decision',request:projections.exports.combat,reply:ActionSchema,decode:(request,reply:Action)=>{const indices=request.player.indices??request.candidates.map((_,index)=>index);if(request.kind==='one'&&request.allowSkip&&reply.bits>>>29===2&&(reply.bits&0xffff)===request.player.skipIndex)return{kind:'skipped' as const};if(request.kind==='one')return{kind:'selected' as const,indices:[reply.bits>>>29===2?indices.indexOf(reply.bits&0xffff):-1]};const mask=reply.bits&0x1fffffff,allowed=indices.reduce((value,index)=>value|(1<<index),0);return{kind:'selected' as const,indices:reply.bits>>>29!==3||(mask&~allowed)!==0?[-1]:indices.flatMap((index,at)=>mask&(1<<index)?[at]:[])};}});
export const booleanCombatAdapter=ruleModules.choicePort({port:'decision',request:projections.exports.booleanCombat,reply:ActionSchema,decode:(request,reply:Action)=>({kind:'selected' as const,indices:[request.candidates.findIndex(value=>booleanChoiceBits(value)===reply.bits)]})});
export const booleanCombatDependencies=[projections];
export const adventureChoices=createAdventureChoices(adventureAdapter,[projections]);
export const combatChoices=createCardChoices(combatAdapter,[projections]);
export const combatSelectionUtils=createCombatSelectionUtils(combatChoices);

/** The only external ports; all rule choices share these existing wire schemas. */
export const stsPorts=defineRules({requires:[adventureChoices,combatChoices,combatSessions],build(){
  const event=ruleModules.portEffect<GameEvent[],null>('event');
  const flush=defineEffect<number,void>(b=>{const count=b.local<number>(),cursor=query(adventures.exports.historyCursor,b.input);return sequence(
    when(b.read(v=>{const s=v.get(cursor);return s.published<s.length;}),sequence(
      b.assign(count,b.read(v=>v.get(cursor).length)),
      call(event,query(adventures.exports.pendingHistory,b.input)),call(adventures.exports.published,{run:b.input,count}),
    )),
  );});
  const beforeAdventure=on(adventures.exports.requesting,{condition:defineQuery({input:typedValue<rules.ReactionContext<number>>(),output:z.boolean(),base:(_r,c)=>c.event===c.owner}),effect:defineEffect<rules.ReactionContext<number>,void>(b=>call(flush,b.read(v=>v.input.owner)))});
  const ownsCard=defineQuery({input:typedValue<rules.ReactionContext<PendingCardChoice>>(),output:z.boolean(),dependencies:[battles.exports.current,adventures.exports.forActor,battles.exports.status],base:(r,c)=>r.query(adventures.exports.forActor,r.query(battles.exports.status,c.event.battle).actor)===c.owner});
  const selectMetadata=defineEffect<rules.ReactionContext<PendingCardChoice>,void>(b=>call(combatSessions.exports.setSelectionMetadata,b.read(v=>{
    const session=v.query(combatSessions.exports.forBattle,v.input.event.battle);if(session===null)throw Error('Selection requires a combat session');
    const screen=v.input.event.screen,simple=([CardScreen.Armaments,CardScreen.ExhaustOne,CardScreen.Headbutt,CardScreen.LiquidMemories,CardScreen.Discovery] as number[]).includes(screen);
    const custom=([CardScreen.VolibearDiscard,CardScreen.VolibearExhaust,CardScreen.VolibearScry,CardScreen.VolibearRetain,CardScreen.VolibearCopy,CardScreen.VolibearRecover,CardScreen.VolibearTrain] as number[]).includes(screen);
    if(custom)return{session,pickCount:v.input.event.maximum??1,canPickZero:v.input.event.minimum===0,canPickAnyNumber:v.input.event.multiple===true&&v.input.event.minimum===0};
    return{session,...(simple?{pickCount:screen===CardScreen.Discovery&&!v.query(combatSessions.exports.current,session).haveUsedDiscoveryAction?v.query(combatSessions.exports.current,session).selectionMetadata.pickCount:1,canPickZero:false,canPickAnyNumber:false}:screen===CardScreen.ExhaustMany?{pickCount:v.input.event.maximum??0}:screen===CardScreen.Forethought?{canPickAnyNumber:false}:{})};
  })));
  const beforeCard=on(combatChoices.exports.requesting,{condition:ownsCard,effect:defineEffect<rules.ReactionContext<PendingCardChoice>,void>(b=>sequence(call(selectMetadata,b.input),call(flush,b.read(v=>v.input.owner))))});
  const cardChosen=on(combatChoices.exports.selected,{condition:defineQuery({input:typedValue<rules.ReactionContext<CardSelection>>(),output:z.boolean(),dependencies:[battles.exports.current,adventures.exports.forActor,battles.exports.status],base:(r,c)=>c.event.interactive&&r.query(adventures.exports.forActor,r.query(battles.exports.status,c.event.battle).actor)===c.owner}),effect:defineEffect<rules.ReactionContext<CardSelection>,void>(b=>call(adventures.exports.record,{run:b.read(v=>v.input.owner),kind:'battle',bits:b.read(v=>v.input.event.bits)}))});
  const initialize=defineEffect<number,void>(b=>sequence(...[beforeAdventure,beforeCard,cardChosen].map(ability=>install({ability,source:b.input,owner:b.input,environment:{},lifetime:b.read(v=>v.query(adventures.exports.bindings,v.input).scope)}))));
  return{exports:{initialize,flush,frame:projections.exports.frame}};
}});


/** Boolean decisions use the same event stream and frame protocol as card picks. */
export function createBooleanCardChoiceHistory(events:{requesting:rules.RuleEvent<CardUse>;selected:rules.RuleEvent<{use:CardUse;value:boolean}>},requires:readonly rules.RuleModule<unknown>[]){
  return defineRules({requires:[stsPorts,adventures,combatSessions,...requires],build(){
    const requested=on(events.requesting,{
      condition:defineQuery({input:typedValue<rules.ReactionContext<CardUse>>(),output:z.boolean(),dependencies:[adventures.exports.forActor],base:(r,c)=>r.query(adventures.exports.forActor,c.event.owner)===c.owner}),
      effect:defineEffect<rules.ReactionContext<CardUse>,void>(b=>sequence(
        call(combatSessions.exports.setSelectionMetadata,b.read(v=>{const session=v.query(combatSessions.exports.forBattle,v.input.event.battle);if(session===null)throw Error('Boolean choice requires a combat session');return{session,pickCount:1,canPickZero:false,canPickAnyNumber:false};})),
        call(stsPorts.exports.flush,b.read(v=>v.input.owner)),
      )),
    });
    const selected=on(events.selected,{
      condition:defineQuery({input:typedValue<rules.ReactionContext<{use:CardUse;value:boolean}>>(),output:z.boolean(),dependencies:[adventures.exports.forActor],base:(r,c)=>r.query(adventures.exports.forActor,c.event.use.owner)===c.owner}),
      effect:defineEffect<rules.ReactionContext<{use:CardUse;value:boolean}>,void>(b=>call(adventures.exports.record,{run:b.read(v=>v.input.owner),kind:'battle',bits:b.read(v=>booleanChoiceBits(v.input.event.value))})),
    });
    const initialize=defineEffect<number,void>(b=>sequence(...[requested,selected].map(ability=>install({ability,source:b.input,owner:b.input,environment:{},lifetime:b.read(v=>v.query(adventures.exports.bindings,v.input).scope)}))));
    return{exports:{initialize}};
  }});
}
