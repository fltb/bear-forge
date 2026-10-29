import type {InstanceSnapshot} from '@bear-forge/contracts/persistence';
import type {JsonValue} from '@bear-forge/contracts/game';
import type {RandomCursor,PolicyRequest} from '@bear-forge/policies';
import type {Observation,Result,Setup,StsEvent} from './game.schemas.ts';

export type DisplayEvent={sequence:number;actionId:string;event:StsEvent};
export type DisplayIdentity={id:string;kind:'entity'|'card'|'player'|'enemy';card?:number;index?:number;battle?:string};
export type SimulatorView={sessionId:string;revision:number;character:NonNullable<Setup['character']>;observation:Observation;request:PolicyRequest|null;result:Result|null;termination:'playing'|'death'|'act3-clear'|'heart-victory'};
export type EventBatch={fromRevision:number;revision:number;actionId:string;events:DisplayEvent[];cursor:number;identities:Record<string,DisplayIdentity>;state:SimulatorView};
export type SimulatorCommand={id:string;sessionId:string;revision:number;action:unknown};
export type CommandReceipt={id:string;revision:number;bits:number;accepted:true;resultRevision:number};
export type SimulatorPolicyState={version:string|null;encoderVersion:string|null;memory:JsonValue;random:RandomCursor};
type SaveState={program:string;sessionId:string;character:NonNullable<Setup['character']>;revision:number;cursor:number;entities:Record<string,DisplayIdentity>;lastCommand:CommandReceipt|null;policyState:SimulatorPolicyState;batch:EventBatch;snapshotId:InstanceSnapshot['snapshotId'];context:Uint8Array};
export type LegacySimulatorSave=SaveState&{format:1};
export type SimulatorSave=SaveState&{format:2;contextVersion:number;createdAt:string;savedAt:string};
export type StoredSimulatorSave=SimulatorSave|LegacySimulatorSave;
/** Storage is the durability boundary; UI and policies never receive this object. */
export type SimulatorStore={read:()=>Promise<StoredSimulatorSave>;pending:(sessionId:string,revision:number)=>Promise<void>;commit:(save:SimulatorSave)=>Promise<void>;close:()=>Promise<void>};
