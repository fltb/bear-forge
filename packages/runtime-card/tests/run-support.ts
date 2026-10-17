import { CardMachine, CardProgram, plainCardStorage } from '@bear-forge/card-engine';
import type { CardDefinition } from '@bear-forge/card-engine';
import type { IO, PortShape } from '@bear-forge/contracts/core';

/** Test driver for the production synchronous Card Core, without the outer layers. */
export async function runCard<S, Setup, P extends { [K in keyof P]: PortShape }, R>(definition: CardDefinition<S, Setup, P, R>, setup: Setup, io: IO<P>): Promise<R> {
  const program = new CardProgram(definition);
  const storage = plainCardStorage(program.initial(setup), structuredClone);
  const machine = new CardMachine(program, storage);
  try {
    let stop = machine.advance();
    while (stop.kind === 'call') stop = machine.advance(await io.call(stop.call));
    if (stop.kind === 'fault') throw Error(stop.error.message);
    return stop.result;
  } finally { storage.close?.(); }
}
