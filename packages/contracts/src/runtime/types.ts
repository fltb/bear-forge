import type { z } from 'zod';
import type { Core, ProgramModule, PortShape, FixedTable, InstancePersistence, InstanceCapture, Instance } from '../core/types.ts';
import type { BaseGame, QueryShape, GameOutcome, GameUpdate } from '../game/types.ts';
import type { GameContract, GameTypes } from '../authoring/types.ts';
import type { CompiledProgramDataSchema } from './schemas.ts';

declare const programWitness: unique symbol;
export type CompiledProgram<S, P extends { [K in keyof P]: PortShape }, R> =
  z.infer<typeof CompiledProgramDataSchema> & FixedTable<P> & {
    readonly [programWitness]: (types: { setup: S; ports: P; result: R }) => { setup: S; ports: P; result: R };
  };
export type LoadedCore<S, P extends { [K in keyof P]: PortShape }, R> = {
  core: Core<S, P, R>;
  persistence?: InstancePersistence<P, R>;
  capture?: InstanceCapture<S, P, R>;
};
export type ControlledCoreLoader = {
  load: <S, P extends { [K in keyof P]: PortShape }, R>(program: CompiledProgram<S, P, R>) => Promise<LoadedCore<S, P, R>>;
};
/** Differential execution uses the same author source, without claiming continuation snapshots. */
export type NativeCoreLoader = {
  load: <S, P extends { [K in keyof P]: PortShape }, R>(program: ProgramModule<S, P, R>) => Promise<LoadedCore<S, P, R>>;
};
export type GameHandle<G extends GameTypes, Q extends { [K in keyof Q]: QueryShape }> = BaseGame<
  G['interactions'], G['actor'], G['delivery'], G['signal'], G['observer'], G['observation'], G['event'], G['result'], Q
>;
/** Transfers exclusive driving authority; does not start another program or own services. */
export type BaseGameBinder = {
  bind: <G extends GameTypes, Q extends { [K in keyof Q]: QueryShape }>(input: {
    instance: Instance<G['ports'], G['programResult']>;
    contract: GameContract<G, Q>;
    persistence?: InstancePersistence<G['ports'], G['programResult']>;
  }) => Promise<GameOutcome<{
    game: GameHandle<G, Q>;
    initial: GameUpdate<G['interactions'], G['actor'], G['event'], G['result']>;
  }>>;
};
