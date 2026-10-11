import type { JsonValue, RequestId, InputOptions } from '@bear-forge/contracts/game';
export type RandomCursor = {
  state: number;
  position: number;
};
export type PolicyRequest = {
  id: RequestId;
  player: string;
  type: string;
  data: JsonValue;
  observation: unknown;
  options: InputOptions<JsonValue, JsonValue>;
};
export type Proposal = {
  action: JsonValue;
  nextMemory: JsonValue;
  nextRandom: RandomCursor;
  policyVersion: string;
  encoderVersion: string;
  logProbability: number | null;
};
export type Policy = {
  version: string;
  encoderVersion: string;
  decide: (input: {
    request: PolicyRequest;
    visibleHistory: unknown[];
    memory: JsonValue;
    random: RandomCursor;
    signal: AbortSignal;
  }) => Promise<Proposal>;
  event?: (memory: JsonValue, event: unknown) => JsonValue;
};
export type ConstructAdapter = {
  ordered: (request: PolicyRequest) => JsonValue[];
  sample: (request: PolicyRequest, random: RandomCursor) => {
    action: JsonValue;
    random: RandomCursor;
    logProbability: number | null;
  };
};
