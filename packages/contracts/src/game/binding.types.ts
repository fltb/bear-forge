import type {Instance,Outcome} from '../instance/instance.types.ts';
import type {InstancePersistence,InstanceSnapshot} from '../instance/persistence.types.ts';
import type {BaseGame,GameError} from './game.types.ts';
import type {GameContract,GameTypes} from './authoring.types.ts';
import type {SessionControl} from './session.types.ts';
export type GameHandle<G extends GameTypes>=BaseGame<G['actions'],G['player'],G['observation'],G['playerEvent'],G['result'],G['control']['input']>&{
 fork?:()=>Promise<Outcome<GameHandle<G>,GameError>>;
 save?:()=>Promise<Outcome<InstanceSnapshot,GameError>>;
}&([G['control']] extends [never]?{}:Partial<SessionControl<G['control']['request'],G['control']['input']>>);
/** The caller supplies the matching author contract for the loaded program. */
export type BaseGameBinder={bind:<G extends GameTypes>(input:{instance:Instance<G['ports'],G['programResult']>;contract:GameContract<G>;persistence?:InstancePersistence<G['ports'],G['programResult']>})=>Promise<Outcome<GameHandle<G>,GameError>>};
