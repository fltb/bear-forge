import type {z} from 'zod';
import type {Core} from './core.types.ts';
import type {ProgramModule,PortShape} from './program.types.ts';
import type {FixedTable} from '../internal/type-utils.ts';
import type {Outcome} from '../instance/instance.types.ts';
import type {InstancePersistence} from '../instance/persistence.types.ts';
import type {InstanceCapture} from '../instance/capture.types.ts';
import type {CompiledProgramDataSchema} from './loading.schemas.ts';
declare const programWitness:unique symbol;
export type CompiledProgram<S,P extends {[K in keyof P]:PortShape},R>=z.infer<typeof CompiledProgramDataSchema>&FixedTable<P>&{
 readonly [programWitness]:(types:{setup:S;ports:P;result:R})=>{setup:S;ports:P;result:R};
};
export type LoadedCore<S,P extends {[K in keyof P]:PortShape},R>={core:Core<S,P,R>;persistence?:InstancePersistence<P,R>;capture?:InstanceCapture<S,P,R>};
export type NativeCoreLoader={load:<S,P extends {[K in keyof P]:PortShape},R>(program:ProgramModule<S,P,R>)=>Promise<Outcome<LoadedCore<S,P,R>>>};
export type ControlledCoreLoader={load:<S,P extends {[K in keyof P]:PortShape},R>(program:CompiledProgram<S,P,R>)=>Promise<Outcome<LoadedCore<S,P,R>>>};
