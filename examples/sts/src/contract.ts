import {z} from 'zod';
import type {GameContract} from '@bear-forge/contracts/authoring';
import {ActionSchema,FrameSchema,ObservationSchema,EventSchema,ResultSchema,type Setup,type Ports,type Frame,type Action,type Observation,type StsEvent,type Result} from './game.schemas.ts';

export type StsTypes={setup:Setup;ports:Ports;programResult:Frame;view:Frame;
  actions:{action:{request:{screen:string};action:Action;description:never}};
  player:'0';observation:Observation;event:StsEvent;playerEvent:StsEvent;result:Result;control:never};
type ReadonlyData<T>=T extends object?{readonly [K in keyof T]:ReadonlyData<T[K]>}:T;
export const runicDomePublication=Object.freeze({
  text:'持有时，隐藏敌人意图。',
  project(frame:ReadonlyData<Frame>){
    const hidden=frame.game.relics.some(r=>r.id==='RUNIC_DOME');
    return frame.battle&&hidden?{...frame.battle,intentHidden:true,intents:[],monsters:frame.battle.monsters.map(m=>({...m,moves:[],damage:0,hits:0}))}:frame.battle;
  },
});
/** Borrow only the stable player publication; the execution graph is never exposed. */
export function observe(frame:ReadonlyData<Frame>):Observation {
  const battle=runicDomePublication.project(frame);
  return {game:frame.game as Frame['game'],battle:battle as Frame['battle'],history:frame.history as Frame['history'],heartDefeated:frame.heartDefeated};
}
export const contract:GameContract<StsTypes>={
  schemas:{view:FrameSchema,player:z.literal('0'),observation:ObservationSchema,event:EventSchema,playerEvent:EventSchema,result:ResultSchema,
    actions:{action:{request:z.strictObject({screen:z.string()}),action:ActionSchema,description:z.never()}}},
  ports:{
    event:{kind:'event',receive:events=>({events:events as StsEvent[],output:null})},
    decision:{kind:'request',receive:frame=>({view:frame as Frame,requests:[{key:'decision:'+frame.decisions,player:'0',type:'action',data:{screen:frame.game.screen}}]}),
      respond:(frame,request,action)=>request.player==='0'&&request.key==='decision:'+frame.decisions&&request.data.screen===frame.game.screen&&frame.actions.some(a=>a.bits===action.bits)
        ?{valid:true,output:action as Action}:{valid:false,reason:'Illegal STS action'}},
  },
  finish:frame=>{
    if(frame.game.outcome===1)throw Error('STS result is not terminal');
    return {view:frame as Frame,result:{outcome:frame.game.outcome===0?'death':'victory',heartDefeated:frame.heartDefeated,act:frame.game.act,floor:frame.game.floor,hp:frame.game.hp}};
  },
  observe,projectEvent:event=>({event:event as StsEvent}),
  inputs:{action:{options:z.strictObject({kind:z.literal('exact'),values:z.array(ActionSchema)}),describe:frame=>({kind:'exact',values:frame.actions as Action[]})}},
};
