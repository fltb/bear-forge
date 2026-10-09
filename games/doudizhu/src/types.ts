import type { GameModule, Submission, GameHandle } from '@bear-forge/contracts';
import type { Frame, Input, Action, Seat, Slot, Delivery, Signal, Observed, AuditEvent, Result, ProgramSetup } from './schemas.ts';
export type DouDizhuPorts = {
  decision: { input: Frame; output: Input };
  event: { input: AuditEvent[]; output: null };
};
export type DouDizhuTypes = {
  setup: ProgramSetup;
  ports: DouDizhuPorts;
  programResult: Frame;
  view: Frame;
  interactions: { action: { request: Slot; input: Action; description: never } };
  actor: Seat;
  delivery: Delivery;
  signal: Signal;
  observer: Seat;
  observation: Observed;
  event: AuditEvent;
  result: Result;
};
export type DouDizhuModule = GameModule<DouDizhuTypes, {}>;
export type DouDizhuSubmission = Submission<DouDizhuTypes>;
export type DouDizhuGame = GameHandle<DouDizhuTypes, {}>;
