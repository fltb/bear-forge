import { z } from 'zod';
import type { ReadView } from '@bear-forge/contracts';
import type { DouDizhuModule, DouDizhuSubmission } from './types.ts';
import type { Action, State, Seat, Frame, Input, AuditEvent } from './schemas.ts';
import { ActionSchema, AuditEventSchema, EventSchema, DeliverySchema, FrameSchema, InputSchema, LegalActionsSchema, ObservedSchema, ResultSchema, SeatSchema, SignalSchema, SlotSchema, StateSchema, programSchemas } from './schemas.ts';
import { program } from './program.ts';
import { plays } from './patterns.ts';
import { validateInput } from './rules.ts';
import { RuleViolation } from './errors.ts';

export const legalActions = (s:State, actor:Seat):Action[] => {
  if (!s.stage?.slots.some(slot=>slot.actor===actor)) return [];
  if(s.phase==='bidding')return [0,1,2,3].filter(n=>n===0||n>s.highBid).map(value=>({kind:'bid',value}));
  if(s.phase==='doubling')return [false,true].map(value=>({kind:'double',value}));
  if(s.phase==='redoubling')return [false,true].map(value=>({kind:'redouble',value}));
  if(s.phase==='playing')return [...(s.last?[{kind:'pass' as const}]:[]),...plays(s.hands[actor],s.last?.play.pattern??null)];
  return [];
};
/** Convert transport/session data into the one input consumed by the rule program. */
export const prepareInput = (view:ReadView<Frame>, submission:ReadView<DouDizhuSubmission>, player:Seat) => {
  const state=StateSchema.parse(view.state);
  let input:Input;
  if(submission.kind==='signal') {
    const signal=SignalSchema.parse(submission.signal);
    input=InputSchema.parse({...signal,boundaryKey:state.stage?.boundaryKey});
    const slot=state.stage?.slots.find(item=>item.slotId===submission.signal.payload.slotId);
    if(!slot||slot.actor!==player)return {valid:false as const,reason:'signal_player_mismatch'};
  }
  else {
    const slot=state.stage?.slots.find(item=>item.slotId===submission.choiceId);
    if(!slot||!state.stage||slot.actor!==player)return {valid:false as const,reason:'unknown_choice'};
    input=InputSchema.parse({kind:'action',stageId:state.stage.stageId,slotId:slot.slotId,actor:slot.actor,receivedAtGameTime:submission.delivery.receivedAtGameTime,action:submission.input.value});
  }
  try { validateInput(state,input); }
  catch(error) { if(error instanceof RuleViolation)return {valid:false as const,reason:error.message};throw error; }
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
      view:FrameSchema,actor:SeatSchema,delivery:DeliverySchema,signal:SignalSchema,player:SeatSchema,observation:ObservedSchema,event:AuditEventSchema,playerEvent:EventSchema,result:ResultSchema,
      interactions:{action:{request:SlotSchema,input:ActionSchema,description:z.never()}},
    },
    ports:{
      event:{kind:'event',receive:events=>({events:z.array(AuditEventSchema).parse(events),output:null})},
      decision:{
        kind:'decision',
        receive(raw){
          const frame=FrameSchema.parse(raw);
          if(!frame.state.stage)throw new Error('decision requires a stage');
          return {view:frame,signalPlayers:frame.state.stage.slots.map(slot=>slot.actor),choices:frame.state.stage.slots.map(slot=>({id:slot.slotId,actor:slot.actor,type:'action' as const,request:slot}))};
        },
        respond:prepareInput,
      },
    },
    finish(raw){
      const frame=FrameSchema.parse(raw);
      if(frame.state.phase!=='ended'||!frame.state.result)throw new Error('program result is not terminal');
      return {view:frame,result:frame.state.result};
    },
    playerFor: actor=>actor,
    observe,
    projectEvent,
    inputs:{action:{options:LegalActionsSchema,describe(view,choice){
      const state=StateSchema.parse(view.state);
      const slot=state.stage?.slots.find(item=>item.slotId===choice.id);
      if(!slot||slot.actor!==choice.actor)throw new Error('choice does not belong to this decision');
      return LegalActionsSchema.parse({kind:'exact',values:legalActions(state,slot.actor)});
    }}},
    queries:{},
  },
};
