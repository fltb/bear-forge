import type {PortShape} from './program.types.ts';
import type {Instance,Outcome} from '../instance/instance.types.ts';
export type Core<S, P extends { [K in keyof P]: PortShape }, R> = {
  start: (setup: S) => Promise<Outcome<Instance<P, R>>>;
};
