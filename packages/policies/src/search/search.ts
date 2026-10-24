import {copy} from '@bear-forge/boundary';
import type {RandomCursor} from '../policy.types.ts';
import {SearchBudget, SearchStopped} from './budget.ts';
import {searchEntropyWord} from './entropy.ts';
import type {ActionEstimate, SearchCurrent, SearchDomain, SearchEvidence, SearchPosition, SearchResult, SearchScore, SearchSuccessor} from './search.types.ts';

type ExecNode = {current: SearchCurrent; children: Map<string, Particle[]>; iterator?: AsyncGenerator<SearchSuccessor, void, void>};
type Particle = {exec: ExecNode; weight: number};
type Outcome = {probability: number; child: BeliefNode};
type Edge = {key: string; outcomes: Outcome[]; score: SearchScore};
type BeliefNode = {position: SearchPosition; particles: Particle[]; depth: number; parent: BeliefNode | undefined;
  edges: Map<string, Edge>; cutoff: boolean; score: SearchScore};
const epsilon = 1e-12;
const leafCost = (p: SearchPosition) => (1 - p.value) / 2;
const unknown = (p: SearchPosition): SearchScore => ({lower: 0, estimate: leafCost(p), upper: 1});
function validate(p: SearchPosition) {
  if (!Number.isFinite(p.value) || p.value < -1 || p.value > 1 || !Number.isFinite(p.round)) throw Error('Invalid public evaluation');
  if (!p.terminal && !p.actions.length) throw Error('Nonterminal search position has no legal actions');
  if (new Set(p.actions.map(a => a.key)).size !== p.actions.length) throw Error('Ambiguous public action identities');
}
function samePublic(a: SearchPosition, b: SearchPosition) {
  return a.information === b.information && a.value === b.value && a.round === b.round && a.terminal === b.terminal &&
    JSON.stringify(a.actions) === JSON.stringify(b.actions);
}
function expected(outcomes: Outcome[]): SearchScore {
  const result = {lower: 0, estimate: 0, upper: 0};
  for (const {probability: p, child} of outcomes) {
    result.lower += p * child.score.lower;
    result.estimate += p * child.score.estimate;
    result.upper += p * child.score.upper;
  }
  return result;
}

/** Weighted AND-OR search over retained current Contexts. R1 restricts every
 * non-root decision to the public baseline; R2 optimizes all public actions.
 * Bounds solve the supplied finite distribution and public leaf objective only.
 * Each Context/action executes once. Revisited edges use cached continuations. */
export async function search(domain: SearchDomain, algorithm: 'r0' | 'r1' | 'r2',
  initialRandom: RandomCursor, budget: SearchBudget): Promise<SearchResult> {
  validate(domain.root);
  if (domain.root.terminal) throw Error('Cannot search a terminal request');
  let random = {...initialRandom}, method = 'public-baseline', reason: string | null = null;
  const expansion={budget,word(){budget.check();const result=searchEntropyWord(random);random=result.random;return result.value;}};
  let representation: SearchEvidence['representation'] = null;
  let root: BeliefNode | undefined;
  const owned = new Set<SearchCurrent>(), executions = new Map<SearchCurrent, ExecNode>();
  const failures: unknown[] = [];
  const baseline = (p: SearchPosition) => {
    const key = domain.baseline(p);
    if (!p.actions.some(a => a.key === key)) throw Error('Baseline proposed an illegal action');
    return key;
  };
  let chosen = baseline(domain.root);
  const allocate = () => budget.allocateNode();
  const retain = (current: SearchCurrent): ExecNode => {
    owned.add(current); // Ownership precedes all validation and budget failures.
    if (executions.has(current)) throw Error('Domain reused a current instead of an independent successor');
    validate(current.position);
    allocate();
    const node: ExecNode = {current, children: new Map()}; executions.set(current, node); return node;
  };
  const successor = async (node: ExecNode, key: string): Promise<Particle[]> => {
    const cached = node.children.get(key);
    if (cached) return cached;
    node.iterator ??= domain.next(node.current,expansion);
    while (!node.children.has(key)) {
      if (budget.nodes >= budget.limits.nodes) {budget.reason = 'node-budget'; throw new SearchStopped(budget.reason);}
      const item = await budget.segment(() => node.iterator!.next(), 'next');
      if (item.done) throw Error('Domain omitted a legal successor');
      const edge = item.value;
      // The entire yielded distribution transfers ownership, even if its first
      // outcome is invalid or retaining it exhausts the node budget.
      for (const outcome of edge.outcomes) owned.add(outcome.current);
      if (node.children.has(edge.action) || !node.current.position.actions.some(a => a.key === edge.action)) {
        throw Error('Domain yielded an illegal or duplicate successor');
      }
      if (edge.representation !== 'exact' && edge.representation !== 'particles') throw Error('Missing successor probability representation');
      if (edge.representation === 'particles') representation = 'particles';
      const mass = edge.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0);
      if (!edge.outcomes.length || !Number.isFinite(mass) || Math.abs(mass - 1) > epsilon ||
          edge.outcomes.some(outcome => !Number.isFinite(outcome.probability) || outcome.probability <= 0)) {
        throw Error('Successor probabilities must be positive and sum to one');
      }
      const children = edge.outcomes.map(outcome => {
        const exec = retain(outcome.current); budget.advances++;
        return {exec, weight: outcome.probability};
      });
      node.children.set(edge.action, children);
      budget.check();
    }
    return node.children.get(key)!;
  };
  const makeBelief = (particles: Particle[], depth: number, parent?: BeliefNode): BeliefNode => {
    if (!particles.length) throw Error('Empty belief');
    if (particles.length > budget.limits.worlds) {
      budget.reason = 'world-budget'; throw new SearchStopped(budget.reason);
    }
    const position = particles[0]!.exec.current.position;
    const mass = particles.reduce((sum, p) => sum + p.weight, 0);
    if (Math.abs(mass - 1) > epsilon || !Number.isFinite(mass)) throw Error('Belief weights must sum to one');
    for (const p of particles) {
      if (!Number.isFinite(p.weight) || p.weight <= 0) throw Error('Invalid particle weight');
      if (!samePublic(position, p.exec.current.position)) throw Error('Particles disagree on public decision');
    }
    allocate();
    const cutoff = position.terminal || depth >= budget.limits.decisions || position.round - domain.root.round >= budget.limits.rounds;
    const estimate = leafCost(position);
    if (cutoff && !position.terminal) budget.truncated++;
    return {position, particles, depth, parent, edges: new Map(), cutoff,
      score: cutoff ? {lower: estimate, estimate, upper: estimate} : unknown(position)};
  };
  const actions = (node: BeliefNode) => algorithm === 'r1' && node.depth > 0 ? [baseline(node.position)] : node.position.actions.map(a => a.key);
  const score = (node: BeliefNode, key: string) => node.edges.get(key)?.score ?? unknown(node.position);
  const backup = (node: BeliefNode) => {
    if (node.cutoff) return;
    for (const edge of node.edges.values()) edge.score = expected(edge.outcomes);
    const scores = actions(node).map(key => score(node, key));
    node.score = {lower: Math.min(...scores.map(s => s.lower)), estimate: Math.min(...scores.map(s => s.estimate)), upper: Math.min(...scores.map(s => s.upper))};
  };
  const expand = async (node: BeliefNode, key: string) => {
    budget.check();
    if (node.cutoff || node.edges.has(key) || !actions(node).includes(key)) throw Error('Invalid belief expansion');
    if (budget.simulations >= budget.limits.simulations) {budget.reason = 'expansion-budget'; throw new SearchStopped(budget.reason);}
    budget.simulations++;
    const groups = new Map<string, {mass: number; particles: Particle[]}>();
    for (const particle of node.particles) {
      budget.check();
      const children = await successor(particle.exec, key);
      for (const child of children) {
        const {exec} = child, information = exec.current.position.information;
        const weight = particle.weight * child.weight;
        if (!(weight > 0)) throw Error('Successor probability underflow');
        let group = groups.get(information);
        if (!group) {group = {mass: 0, particles: []}; groups.set(information, group);}
        group.mass += weight; group.particles.push({exec, weight});
      }
    }
    const outcomes: Outcome[] = [];
    for (const group of groups.values()) {
      budget.check();
      outcomes.push({probability: group.mass, child: makeBelief(group.particles.map(p => ({exec: p.exec, weight: p.weight / group.mass})), node.depth + 1, node)});
    }
    budget.check();
    // Publish atomically: partial advancement never becomes a renormalized edge.
    node.edges.set(key, {key, outcomes, score: expected(outcomes)}); budget.completed++;
    for (let ancestor: BeliefNode | undefined = node; ancestor; ancestor = ancestor.parent) backup(ancestor);
  };
  const select = (node: BeliefNode): {node: BeliefNode; key: string} | null => {
    budget.check();
    if (node.cutoff || node.score.upper - node.score.lower <= epsilon) return null;
    const ranked = actions(node).map((key, index) => ({key, index, score: score(node, key)}));
    ranked.sort((a, b) => a.score.lower - b.score.lower || a.score.estimate - b.score.estimate || a.index - b.index);
    const key = ranked[0]!.key, edge = node.edges.get(key);
    if (!edge) return {node, key};
    const outcomes = edge.outcomes.map((o, index) => ({...o, index, priority: o.probability * (o.child.score.upper - o.child.score.lower)}));
    outcomes.sort((a, b) => b.priority - a.priority || a.index - b.index);
    for (const outcome of outcomes) {const pending = select(outcome.child); if (pending) return pending;}
    return null;
  };
  try {
    budget.check();
    if (algorithm !== 'r0') {
      const samples = await budget.segment(() => domain.current(random, budget), 'current');
      // All transferred roots must close, including invalid or over-budget roots.
      for (const p of samples.particles) owned.add(p.current);
      if (!samples.particles.length) throw Error('No current state supplied');
      if (owned.size !== samples.particles.length) throw Error('Duplicate current sample');
      if (samples.particles.length > budget.limits.worlds) throw Error('Current sample limit exceeded');
      if (samples.representation !== 'exact' && samples.representation !== 'particles') throw Error('Missing probability representation');
      for (const p of samples.particles) if (!samePublic(p.current.position, domain.root)) throw Error('Current does not match public root');
      budget.check();
      root = makeBelief(samples.particles.map(p => ({exec: retain(p.current), weight: p.weight})), 0);
      random = samples.random; method = samples.method; representation = samples.representation; reason = samples.reason;
      // Every legal root candidate receives a complete action edge before depth search.
      for (const action of domain.root.actions) await expand(root, action.key);
      for (;;) {
        const pending = select(root);
        if (!pending) break;
        await expand(pending.node, pending.key);
      }
    }
  } catch (error) {
    if (!(error instanceof SearchStopped)) {failures.push(error); throw error;}
    reason = budget.signal.aborted ? 'cancelled' : budget.reason ?? 'budget-exhausted';
  } finally {
    const cleanup: unknown[] = [];
    for (const node of executions.values()) if (node.iterator) try {await budget.measure(() => node.iterator!.return(), 'cleanup');} catch (error) {cleanup.push(error);}
    for (const current of [...owned].reverse()) try {await budget.measure(() => current.close(), 'cleanup');} catch (error) {cleanup.push(error);}
    if (cleanup.length) throw new AggregateError([...failures, ...cleanup], 'Search state cleanup failed');
  }
  const rows: ActionEstimate[] = domain.root.actions.map(a => {
    const edge = root?.edges.get(a.key);
    return {key: a.key, expanded: !!edge, ...(edge?.score ?? unknown(domain.root)),
      outcomes: edge?.outcomes.map(o => ({probability: o.probability, particles: o.child.particles.length})) ?? []};
  });
  const coverageComplete = rows.every(row => row.expanded);
  const rootScore = root?.score ?? unknown(domain.root);
  if (coverageComplete) {
    // A certified choice takes precedence over an attractive but uncertain estimate.
    const certified = rows.find(row => row.upper <= rootScore.lower + epsilon);
    chosen = (certified ?? rows.reduce((a, b) => b.estimate < a.estimate ? b : a)).key;
  } else if (algorithm !== 'r0') reason ??= 'incomplete-root-coverage';
  const evidence: SearchEvidence = {algorithm, solver: algorithm === 'r0' ? 'public-baseline' : algorithm === 'r1' ? 'fixed-policy-belief' : 'belief-ao',
    objective: 'finite-horizon-public-leaf-cost', representation, score: rootScore,
    selectedUpperGap: coverageComplete ? Math.max(0, rows.find(row => row.key === chosen)!.upper - rootScore.lower) : null,
    method, reason, coverageComplete, actions: rows, attempts: budget.attempts, rejected: budget.rejected, accepted: budget.accepted,
    simulations: budget.simulations, completed: budget.completed, truncated: budget.truncated, advances: budget.advances, nodes: budget.nodes};
  return {action: copy(domain.root.actions.find(a => a.key === chosen)!.action), random, evidence, cost: budget.cost()};
}
