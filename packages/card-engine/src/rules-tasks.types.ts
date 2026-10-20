import type {Effect,Input,Value} from './rules.types.ts';
import type {RuleEvent} from './rules-module.types.ts';
import type {Query} from './rules-query.types.ts';
export type RuleQueue=Readonly<{label?:string}>;
export type QueueOptions={queue:RuleQueue;position?:'front'|'back';source?:Input<number|null>;lifetime:Input<number>;eligible?:'captured'|'source-present'};
export type SchedulePoint<T,I>={event:RuleEvent<T>;condition?:Query<{event:T;input:I;source:number|null},boolean>};
export type ScheduleOptions<T,I>=Omit<QueueOptions,'position'>&{at:SchedulePoint<T,I>};
export type RuntimeEffectReference={program:string;effect:number;source:number|null;selector:number|null};
export type RuleTask={id:number;effect:RuntimeEffectReference;input:any;queue:number;source:number|null;lifetime:number;eligible:'captured'|'source-present';state:'scheduled'|'pending'|'running';at:number|null;condition:number|null;position:'front'|'back'};
