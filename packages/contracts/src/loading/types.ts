import type {z} from 'zod';
import type {Core,ProgramModule,PortShape} from '../core/types.ts';
import type {FixedTable} from '../internal/types.ts';
import type {Instance,Outcome} from '../instance/types.ts';
import type {InstancePersistence,InstanceSnapshot} from '../persistence/types.ts';
import type {InstanceCapture} from '../capture/types.ts';
import type {BaseGame,GameError} from '../game/types.ts';
import type {GameContract,GameTypes} from '../authoring/types.ts';
import type {SessionControl} from '../session/types.ts';
import type {CompiledProgramDataSchema} from './schemas.ts';
declare const programWitness:unique symbol;
export type CompiledProgram<S,P extends {[K in keyof P]:PortShape},R>=z.infer<typeof CompiledProgramDataSchema>&FixedTable<P>&{
 readonly [programWitness]:(types:{setup:S;ports:P;result:R})=>{setup:S;ports:P;result:R};
};
export type LoadedCore<S,P extends {[K in keyof P]:PortShape},R>={core:Core<S,P,R>;persistence?:InstancePersistence<P,R>;capture?:InstanceCapture<S,P,R>};
export type NativeCoreLoader={load:<S,P extends {[K in keyof P]:PortShape},R>(program:ProgramModule<S,P,R>)=>Promise<Outcome<LoadedCore<S,P,R>>>};
export type ControlledCoreLoader={load:<S,P extends {[K in keyof P]:PortShape},R>(program:CompiledProgram<S,P,R>)=>Promise<Outcome<LoadedCore<S,P,R>>>};
export type GameHandle<G extends GameTypes>=BaseGame<G['actions'],G['player'],G['observation'],G['playerEvent'],G['result'],G['control']['input']>&{
 fork?:()=>Promise<Outcome<GameHandle<G>,GameError>>;
 save?:()=>Promise<Outcome<InstanceSnapshot,GameError>>;
}&([G['control']] extends [never]?{}:Partial<SessionControl<G['control']['request'],G['control']['input']>>);
/** The caller supplies the matching author contract for the loaded program. */
export type BaseGameBinder={bind:<G extends GameTypes>(input:{instance:Instance<G['ports'],G['programResult']>;contract:GameContract<G>;persistence?:InstancePersistence<G['ports'],G['programResult']>})=>Promise<Outcome<GameHandle<G>,GameError>>};
