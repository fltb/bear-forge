import {combatSessions} from "../rules/combat-sessions.ts";
import {CardScreen} from "./selection-presentations.ts";
import {z} from 'zod';
import {rules,ruleModules} from '@bear-forge/card-engine';
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
const selectionSchema=z.object({screen:z.number(),cards:z.array(z.number()),pickCount:z.number().optional(),canPickZero:z.boolean().optional(),canPickAnyNumber:z.boolean().optional()}).nullable();
const projections=defineRules({requires:[adventureViews,combatViews,battlePublications],build(){
  const frame=defineQuery({input:z.object({run:z.number(),actions:z.array(z.number()),selection:selectionSchema}),output:FrameSchema,dependencies:[adventureViews.exports.game,combatViews.exports.battle,adventures.exports.current,battlePublications.exports.forRun],base(r,i){
    const s=r.query(adventures.exports.current,i.run),live=r.query(adventureViews.exports.game,i.run),entry=r.query(battlePublications.exports.forRun,i.run);return{game:entry?{...entry,hp:live.hp,maxHp:live.maxHp,gold:live.gold,potions:live.potions}:live,battle:r.query(combatViews.exports.battle,{run:i.run,selection:i.selection}),actions:i.actions.map(bits=>({bits})),decisions:s.history.length,history:s.history,heartDefeated:s.outcome===2&&s.act===4};
  }});
  const adventure=defineQuery({input:z.custom<rules.ChoiceRequest<number,number>>(),output:FrameSchema,dependencies:[frame],base:(r,i)=>r.query(frame,{run:i.player,actions:[...i.candidates],selection:null})});
  const combat=defineQuery({input:z.custom<rules.ChoiceRequest<number,CardChoicePlayer>>(),output:FrameSchema,dependencies:[frame,battles.exports.current,adventures.exports.forActor],base(r,i){
    const run=r.query(adventures.exports.forActor,r.query(battles.exports.current,i.player.battle).actor);if(run===null)throw Error('Card choice has no adventure');const indices=i.player.indices??i.candidates.map((_,index)=>index),actions:number[]=[];if(i.kind==='one'){for(const index of indices)actions.push(((2<<29)|index)>>>0);if(i.allowSkip&&i.player.skipIndex!==undefined)actions.push(((2<<29)|i.player.skipIndex)>>>0);}else{for(let mask=0;mask<(1<<indices.length);mask++){const picked=indices.filter((_,index)=>mask&(1<<index));if(picked.length>=i.min&&picked.length<=i.max)actions.push(((3<<29)|picked.reduce((bits,index)=>bits|(1<<index),0))>>>0);}}return r.query(frame,{run,actions,selection:{screen:i.player.screen,cards:[...i.candidates],pickCount:i.max,canPickZero:false,canPickAnyNumber:false}});
  }});
  return{exports:{frame,adventure,combat}};
}});

const adventureAdapter=ruleModules.choicePort({port:'decision',request:projections.exports.adventure,reply:ActionSchema,decode:(request,reply:Action)=>({kind:'selected' as const,indices:[request.candidates.indexOf(reply.bits)]})});
const combatAdapter=ruleModules.choicePort({port:'decision',request:projections.exports.combat,reply:ActionSchema,decode:(request,reply:Action)=>{const indices=request.player.indices??request.candidates.map((_,index)=>index);if(request.kind==='one'&&request.allowSkip&&reply.bits>>>29===2&&(reply.bits&0xffff)===request.player.skipIndex)return{kind:'skipped' as const};if(request.kind==='one')return{kind:'selected' as const,indices:[reply.bits>>>29===2?indices.indexOf(reply.bits&0xffff):-1]};const mask=reply.bits&0x1fffffff,allowed=indices.reduce((value,index)=>value|(1<<index),0);return{kind:'selected' as const,indices:reply.bits>>>29!==3||(mask&~allowed)!==0?[-1]:indices.flatMap((index,at)=>mask&(1<<index)?[at]:[])};}});
export const adventureChoices=createAdventureChoices(adventureAdapter,[projections]);
export const combatChoices=createCardChoices(combatAdapter,[projections]);
export const combatSelectionUtils=createCombatSelectionUtils(combatChoices);

/** The only external ports; all rule choices share these existing wire schemas. */
export const stsPorts=defineRules({requires:[adventureChoices,combatChoices,combatSessions],build(){
  const event=ruleModules.portEffect<GameEvent[],null>('event');
  const flush=defineEffect<number,void>(b=>{const count=b.local<number>();return sequence(
    when(b.read(v=>{const s=v.get(query(adventures.exports.current,v.input));return s.published<s.history.length;}),sequence(
      b.assign(count,b.read(v=>v.get(query(adventures.exports.current,v.input)).history.length)),
      call(event,b.read(v=>{const s=v.get(query(adventures.exports.current,v.input));return s.history.slice(s.published);})),call(adventures.exports.published,{run:b.input,count}),
    )),
  );});
  const beforeAdventure=on(adventures.exports.requesting,{condition:defineQuery({input:z.custom<rules.ReactionContext<number>>(),output:z.boolean(),base:(_r,c)=>c.event===c.owner}),effect:defineEffect<rules.ReactionContext<number>,void>(b=>call(flush,b.read(v=>v.input.owner)))});
  const ownsCard=defineQuery({input:z.custom<rules.ReactionContext<PendingCardChoice>>(),output:z.boolean(),dependencies:[battles.exports.current,adventures.exports.forActor],base:(r,c)=>r.query(adventures.exports.forActor,r.query(battles.exports.current,c.event.battle).actor)===c.owner});
  const selectMetadata=defineEffect<rules.ReactionContext<PendingCardChoice>,void>(b=>call(combatSessions.exports.setSelectionMetadata,b.read(v=>{
    const session=v.get(query(combatSessions.exports.forBattle,v.input.event.battle));if(session===null)throw Error('Selection requires a combat session');
    const screen=v.input.event.screen,simple=([CardScreen.Armaments,CardScreen.ExhaustOne,CardScreen.Headbutt,CardScreen.LiquidMemories,CardScreen.Discovery] as number[]).includes(screen);
    return{session,...(simple?{pickCount:screen===CardScreen.Discovery&&!v.get(query(combatSessions.exports.current,session)).haveUsedDiscoveryAction?v.get(query(combatSessions.exports.current,session)).selectionMetadata.pickCount:1,canPickZero:false,canPickAnyNumber:false}:screen===CardScreen.ExhaustMany?{pickCount:v.input.event.maximum??0}:screen===CardScreen.Forethought?{canPickAnyNumber:false}:{})};
  })));
  const beforeCard=on(combatChoices.exports.requesting,{condition:ownsCard,effect:defineEffect<rules.ReactionContext<PendingCardChoice>,void>(b=>sequence(call(selectMetadata,b.input),call(flush,b.read(v=>v.input.owner))))});
  const cardChosen=on(combatChoices.exports.selected,{condition:defineQuery({input:z.custom<rules.ReactionContext<CardSelection>>(),output:z.boolean(),dependencies:[battles.exports.current,adventures.exports.forActor],base:(r,c)=>c.event.interactive&&r.query(adventures.exports.forActor,r.query(battles.exports.current,c.event.battle).actor)===c.owner}),effect:defineEffect<rules.ReactionContext<CardSelection>,void>(b=>call(adventures.exports.record,{run:b.read(v=>v.input.owner),kind:'battle',bits:b.read(v=>v.input.event.bits)}))});
  const initialize=defineEffect<number,void>(b=>sequence(...[beforeAdventure,beforeCard,cardChosen].map(ability=>install({ability,source:b.input,owner:b.input,environment:{},lifetime:b.read(v=>v.get(query(adventures.exports.current,v.input)).scope)}))));
  return{exports:{initialize,flush,frame:projections.exports.frame}};
}});
