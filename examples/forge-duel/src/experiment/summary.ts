import type { TaskResult, TaskSummary } from './experiment.types.ts';
export function taskSummary(row: TaskResult): TaskSummary {
  const opportunities: TaskSummary['opportunities'] = {},
    seen = new Set<string>();
  for (const fact of row.facts) {
    if (fact.actor !== row.input.seat || !fact.definition || !['carry', 'draw', 'available', 'play'].includes(fact.kind) || seen.has(fact.key)) continue;
    seen.add(fact.key);
    const counts = opportunities[fact.definition] ??= {
      carry: 0,
      draw: 0,
      available: 0,
      play: 0
    };
    counts[fact.kind as keyof typeof counts]++;
  }
  return {
    id: row.id,
    input: row.input,
    attempt: row.attempt,
    status: row.status,
    result: row.result,
    cost: row.cost,
    opportunities,
    ...(row.attempts ? {
      attempts: row.attempts
    } : {}),
    ...(row.lineage ? {
      lineage: row.lineage
    } : {}),
    ...(row.error ? {
      error: row.error
    } : {})
  };
}
