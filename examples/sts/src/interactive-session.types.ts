import type {Action,Observation,Result,StsEvent} from './game.schemas.ts';
export type InteractiveCommand={op:'observe'}|{op:'quit'}|{op:'act';sessionId:string;decision:number;action:number;reason:string};
export type InteractiveRecord={sessionId:string;decision:number;observation:Observation;actions:Action[]};
export type InteractiveStatus={kind:'decision';record:InteractiveRecord}|{kind:'ended';result:Result;observation:Observation};
export type InteractiveOptions={character:'volibear'|'ironclad';seed:string;sessionId:string;review:boolean;onEvent:(event:StsEvent)=>void|Promise<void>};
