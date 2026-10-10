import type {CallbackReply,CallbackControl,CallId,InstanceId,Outcome} from '../instance/instance.types.ts';
import type {GameError} from './game.types.ts';
/** Optional host/session input, separate from all player actions. */
export type SessionControl<Q,I>={
  bindControl:(handler:((request:{instanceId:InstanceId;callId:CallId;data:Q},control:CallbackControl)=>Promise<CallbackReply<I>>)|null)=>Promise<Outcome<void,GameError>>;
};
