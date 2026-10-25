import type {JsonValue} from '@bear-forge/contracts/game';
import type {Policy,PolicyRequest} from './policy.types.ts';

/** The UI supplies a choice. This policy never owns or advances a game. */
export function createHumanPolicy(choose:(request:PolicyRequest,signal:AbortSignal)=>Promise<JsonValue>):Policy {
  return {version:'human/1',encoderVersion:'public-request/1',async decide(input){
    const action=await choose(input.request,input.signal);
    input.signal.throwIfAborted();
    return {action,nextMemory:input.memory,nextRandom:input.random,policyVersion:'human/1',encoderVersion:'public-request/1',logProbability:null};
  }};
}
