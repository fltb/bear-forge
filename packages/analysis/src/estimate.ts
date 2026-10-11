import type { Registration, TaskResult, TaskSummary } from '@bear-forge/experiments';
import type { Relation } from './analysis.types.ts';
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state, 1664525) + 1013904223 >>> 0;
    return state / 4294967296;
  };
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
export function bootstrap(values: number[], seed: number, repeats: number, tail: number): [number, number] {
  if (!values.length) throw Error('Empty bootstrap');
  const next = random(seed),
    samples: number[] = [];
  for (let b = 0; b < repeats; b++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[Math.floor(next() * values.length)]!;
    samples.push(sum / values.length);
  }
  samples.sort((a, b) => a - b);
  return [samples[Math.floor((samples.length - 1) * tail)]!, samples[Math.ceil((samples.length - 1) * (1 - tail))]!];
}
function opportunities(rows: (TaskResult | TaskSummary)[]) {
  const counts: Relation['opportunities'] = {};
  const seen = new Set<string>();
  for (const row of rows) {
    if ('opportunities' in row) {
      for (const [definition, opportunity] of Object.entries(row.opportunities)) {
        const c = counts[definition] ??= {
          carry: 0,
          draw: 0,
          available: 0,
          play: 0
        };
        for (const kind of ['carry', 'draw', 'available', 'play'] as const) c[kind] += opportunity[kind];
      }
      continue;
    }
    for (const f of row.facts) {
      if (f.actor !== row.input.seat || !['carry', 'draw', 'available', 'play'].includes(f.kind) || !f.definition) continue;
      const key = row.id + '/' + f.key;
      if (seen.has(key)) continue;
      seen.add(key);
      const c = counts[f.definition] ??= {
        carry: 0,
        draw: 0,
        available: 0,
        play: 0
      };
      c[f.kind as keyof typeof c]++;
    }
  }
  return counts;
}
function phaseRelations(config: Registration, rows: (TaskResult | TaskSummary)[], phase: Relation['phase'], candidates?: Set<string>): Relation[] {
  const relations: Relation[] = [];
  for (const policy of config.policies) for (const opponent of config.opponents) for (const kind of ['matchup', 'replacement', 'interaction'] as const) {
    const id = [kind, policy, opponent].join('/');
    if (candidates && !candidates.has(id)) continue;
    const selected = rows.filter(r => r.input.phase === phase && r.input.policy === policy && r.input.opponent === opponent);
    const index = new Map(selected.map(r => [`${r.input.block}/${r.input.seat}/${r.input.replacement}/${r.input.support}`, r]));
    const values: number[] = [];
    const evidence: string[] = [];
    for (let block = 0; block < config.blocks; block++) {
      const seatEffects: number[] = [];
      let valid = true;
      const used: (TaskResult | TaskSummary)[] = [];
      for (const seat of ['0', '1']) {
        const lookup = (replacement: number, support: number) => index.get(`${block}/${seat}/${replacement}/${support}`);
        const required = kind === 'matchup' ? [lookup(0, 0)] : kind === 'replacement' ? [lookup(0, 0), lookup(1, 0)] : [lookup(0, 0), lookup(1, 0), lookup(0, 1), lookup(1, 1)];
        if (required.some(r => !r || r.status !== 'ended' || !Number.isFinite(r.result?.scores?.[seat]))) {
          valid = false;
          break;
        }
        const scores = required.map(r => r!.result.scores[seat]);
        used.push(...(required as (TaskResult | TaskSummary)[]));
        seatEffects.push(kind === 'matchup' ? scores[0]! - 0.5 : kind === 'replacement' ? scores[1]! - scores[0]! : scores[3]! - scores[2]! - scores[1]! + scores[0]!);
      }
      if (valid) {
        values.push(mean(seatEffects));
        evidence.push(...used.map(r => r.id));
      }
    }
    const m = Math.max(1, candidates?.size ?? 1),
      repeats = Math.max(config.bootstrap, 400 * m),
      interval = values.length ? bootstrap(values, config.analysisSeed, repeats, 0.025 / m) : null;
    let status: Relation['status'] = values.length ? 'unknown' : 'missing';
    if (values.length >= config.minimumBlocks && interval) {
      if (interval[0] > config.margin) status = 'positive';else if (interval[1] < -config.margin) status = 'negative';else if (interval[0] >= -config.margin && interval[1] <= config.margin) status = 'equivalent';
    }
    relations.push({
      id,
      kind,
      policy,
      opponent,
      phase,
      status,
      effect: values.length ? mean(values) : null,
      interval,
      blocks: values.length,
      missing: config.blocks - values.length,
      confirmed: phase === 'confirmation',
      candidateCount: candidates?.size ?? 0,
      opportunities: opportunities(selected.filter(r => r.status === 'ended')),
      evidence
    });
  }
  return relations;
}
/** Candidates are frozen solely from discovery before confirmation rows are read. */
export function analyze(config: Registration, rows: (TaskResult | TaskSummary)[]) {
  const ids = new Set<string>(),
    cells = new Set<string>();
  for (const row of rows) {
    const cell = [row.input.phase, row.input.policy, row.input.opponent, row.input.block, row.input.seat, row.input.replacement, row.input.support].join('/');
    if (row.lineage?.kind === 'branch' || row.lineage && row.lineage.rootTaskId !== row.id || ids.has(row.id) || cells.has(cell)) throw Error('Duplicate task or paired cell: retries and branches are not independent samples');
    ids.add(row.id);
    cells.add(cell);
  }
  const discovery = phaseRelations(config, rows.filter(r => r.input.phase === 'discovery'), 'discovery');
  const candidates = new Set(discovery.filter(r => r.status === 'positive' || r.status === 'negative' || r.status === 'equivalent').map(r => r.id));
  const confirmation = phaseRelations(config, rows.filter(r => r.input.phase === 'confirmation'), 'confirmation', candidates);
  return {
    version: 1,
    experimentId: config.id,
    adaptation: 'frozen-policies',
    candidates: [...candidates].sort(),
    relations: [...discovery, ...confirmation],
    cost: {
      milliseconds: rows.reduce((s, r) => s + (r.attempts?.length ? r.attempts.reduce((sum, a) => sum + (a.cost?.milliseconds ?? 0), 0) : r.cost.milliseconds), 0),
      unknownCostAttempts: rows.reduce((s, r) => s + (r.attempts?.filter(a => !a.cost).length ?? 0), 0),
      attempts: rows.reduce((s, r) => s + r.attempt, 0),
      tasks: rows.length,
      ended: rows.filter(r => r.status === 'ended').length,
      fault: rows.filter(r => r.status === 'fault').length,
      truncated: rows.filter(r => r.status === 'truncated').length
    }
  };
}
