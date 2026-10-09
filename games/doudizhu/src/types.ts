import type {GameModule,RequestData} from '@bear-forge/contracts/authoring';
import type {GameHandle} from '@bear-forge/contracts/loading';
import type {Frame,Input,Action,Seat,Slot,Observed,AuditEvent,Result,ProgramSetup,SessionInput,SessionRequest} from './schemas.ts';
export type DouDizhuPorts={decision:{input:Frame;output:Input};event:{input:AuditEvent[];output:null}};
export type DouDizhuTypes={
 setup:ProgramSetup;ports:DouDizhuPorts;programResult:Frame;view:Frame;
 actions:{action:{request:Pick<Slot,'actionSpec'>;action:Action;description:never}};
 player:Seat;observation:Observed;event:AuditEvent;playerEvent:AuditEvent['event'];result:Result;
 control:{request:SessionRequest;input:SessionInput};
};
export type DouDizhuModule=GameModule<DouDizhuTypes>;
export type DouDizhuRequest=RequestData<DouDizhuTypes>;
export type DouDizhuGame=GameHandle<DouDizhuTypes>;
