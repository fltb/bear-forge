import { z } from 'zod';
type ReadView<T>=T extends object?{readonly [K in keyof T]:ReadView<T[K]>}:T;
import type { DouDizhuModule, DouDizhuRequest } from './types.ts';
import type { Action, State, Seat, Frame, Input, AuditEvent, SessionInput } from './schemas.ts';
import { ActionSchema, AuditEventSchema, EventSchema, SessionInputSchema, SessionRequestSchema, FrameSchema, InputSchema, LegalActionsSchema, ObservedSchema, ResultSchema, SeatSchema, SlotSchema, StateSchema, gamePorts, programSchemas } from './schemas.ts';
import { program } from './program.ts';
import { plays } from './patterns.ts';
import { validateInput } from './rules.ts';
import { RuleViolation } from './errors.ts';

export const legalActions = (s:State, actor:Seat):Action[] => {
  if (!s.stage?.slots.some(slot=>slot.actor===actor&&s.now<slot.deadline.atGameTime)) return [];
  if(s.phase==='bidding')return [0,1,2,3].filter(n=>n===0||n>s.highBid).map(value=>({kind:'bid',value}));
  if(s.phase==='doubling')return [false,true].map(value=>({kind:'double',value}));
  if(s.phase==='redoubling')return [false,true].map(value=>({kind:'redouble',value}));
  if(s.phase==='playing')return [...(s.last?[{kind:'pass' as const}]:[]),...plays(s.hands[actor],s.last?.play.pattern??null)];
  return [];
};
/** Pure player action conversion; session time is already part of the game state. */
export const prepareAction=(view:ReadView<Frame>,request:ReadView<DouDizhuRequest>,action:ReadView<Action>)=>{
  const state=StateSchema.parse(view.state);
  const slot=state.stage?.slots.find(slot=>slot.slotId===request.key&&slot.actor===request.player);
  if(!slot||!state.stage)return {valid:false as const,reason:'unknown_request'};
  const input=InputSchema.parse({kind:'action',stageId:state.stage.stageId,slotId:slot.slotId,actor:slot.actor,action});
  if(input.kind!=='action')throw new Error('expected action');
  try{validateInput(state,input);}catch(error){if(error instanceof RuleViolation)return {valid:false as const,reason:error.message};throw error;}
  return {valid:true as const,output:input};
};
export const prepareControl=(view:ReadView<Frame>,raw:ReadView<SessionInput>)=>{
  const state=StateSchema.parse(view.state),control=SessionInputSchema.parse(raw);
  if(control.kind==='clock')return control.at<state.now?{valid:false as const,reason:'clock moved backwards'}:{valid:true as const,output:control};
  if(!state.stage)return {valid:false as const,reason:'no pending request'};
  const input=InputSchema.parse({kind:'host',boundaryKey:state.stage.boundaryKey,inputType:'timeout',gameTime:control.at,payload:{slotId:control.slotId}});
  if(input.kind!=='host')throw new Error('expected timeout');
  try{validateInput(state,input);}catch(error){if(error instanceof RuleViolation)return {valid:false as const,reason:error.message};throw error;}
  return {valid:true as const,output:input};
};
export const projectEvent = (raw:ReadView<AuditEvent>,player:Seat) =>
  raw.audience==='public'||raw.audience===player ? {event:EventSchema.parse(raw.event)} : null;
export const observe = (view:ReadView<Frame>, actor:Seat) => {
  const s=view.state;
  return ObservedSchema.parse({observation:{
    actor,phase:s.phase,deal:s.deal,hand:s.hands[actor],counts:{'0':s.hands['0'].length,'1':s.hands['1'].length,'2':s.hands['2'].length},
    firstBidder:s.firstBidder,landlord:s.landlord,highBid:s.highBid,
    turn:s.phase==='bidding'||s.phase==='playing'?s.turn:s.phase==='redoubling'?s.landlord:null,
    bottom:s.bottomRevealed?s.bottom:null,doubles:s.doublesRevealed?s.doubles:null,ownDouble:s.doubles[actor],redoubled:s.bottomRevealed?s.redoubled:null,last:s.last,result:s.result,
  },events:s.events.flatMap(e=>{const projected=projectEvent(e,actor);return projected?[projected.event]:[];})});
};
/** Game program and its shared projection contract. */
export const game:DouDizhuModule = {
  program:{schemas:programSchemas,run:program},
  contract:{
    schemas:{
      view:FrameSchema,player:SeatSchema,observation:ObservedSchema,event:AuditEventSchema,playerEvent:EventSchema,result:ResultSchema,
      actions:{action:{request:SlotSchema.pick({actionSpec:true}),action:ActionSchema,description:z.never()}},
    },
    ports:{
      event:{kind:gamePorts.event.kind,receive:events=>({events:z.array(AuditEventSchema).parse(events),output:null})},
      decision:{
        kind:gamePorts.decision.kind,
        receive(raw){
          const frame=FrameSchema.parse(raw);
          if(!frame.state.stage)throw new Error('decision requires a stage');
          return {view:frame,requests:frame.state.stage.slots.map(slot=>({key:slot.slotId,player:slot.actor,type:'action' as const,data:{actionSpec:slot.actionSpec}}))};
        },
        respond:prepareAction,
        session:{requestSchema:SessionRequestSchema,inputSchema:SessionInputSchema,request:view=>({now:view.state.now,deadlines:view.state.stage!.slots.map(slot=>({slotId:slot.slotId,at:slot.deadline.atGameTime}))}),respond:prepareControl},
      },
    },
    finish(raw){
      const frame=FrameSchema.parse(raw);
      if(frame.state.phase!=='ended'||!frame.state.result)throw new Error('program result is not terminal');
      return {view:frame,result:frame.state.result};
    },
    observe,
    projectEvent,
    inputs:{action:{options:LegalActionsSchema,describe(view,choice){
      const state=StateSchema.parse(view.state);
      const slot=state.stage?.slots.find(item=>item.slotId===choice.key);
      if(!slot||slot.actor!==choice.player)throw new Error('choice does not belong to this decision');
      return LegalActionsSchema.parse({kind:'exact',values:legalActions(state,slot.actor)});
    }}},
  },
};
