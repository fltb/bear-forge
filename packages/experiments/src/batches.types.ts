export type BatchState<B, R> = {
  pending: B | null;
  completed: B[];
  result: R | null;
};
export type BatchTransition<B, R> = { next: B | null; result: R };
