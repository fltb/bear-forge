import test from 'node:test';
import assert from 'node:assert/strict';
import {CardProgram} from '@bear-forge/card-engine';
import {createCardLoader} from '@bear-forge/runtime-card';
import {createGameBinder} from '@bear-forge/game-host';
import {search, defaultSearchLimits, type SearchDomain} from '@bear-forge/policies';
import {registerCurrentSource, withCurrentSource} from '../../../packages/game-host/src/current.ts';
import {inspectProbabilityTracking} from '../../../packages/runtime-card/src/probability-tracking.ts';
import {cardDefinition} from '../src/card.ts';
import {contract} from '../src/contract.ts';
import type {StsEvent} from '../src/game.schemas.ts';
import {describeAction} from '../src/presentation.ts';
import {publicDecision} from '../src/search/information.ts';
import {position, baseline} from '../src/search/evaluation.ts';
import {createStsProbabilityContinuation} from '../src/search/probability-current.ts';
import {openStsSearchBudget} from '../src/search/resources.ts';

const unwrap = <T>(result: {ok: true; value: T} | {ok: false; error: unknown}): T => {
  if (!result.ok) throw Error(JSON.stringify(result.error));
  return result.value;
};

// Registered development coverage: existing seed 130, two characters, at most
// 96 accepted decisions each, ending on death or the first post-combat map.
// Two baseline paths plus one Volibear path driven by R2 in combat. Each window
// receives bounded search. One additional Volibear path continues to shop,
// rest and a later event, with the same 96-decision and 60-second game caps.
// This is integration coverage, not a strength eval.
for (const {character,drive} of [{character:'ironclad',drive:'baseline'},{character:'volibear',drive:'baseline'},{character:'volibear',drive:'r2'},{character:'volibear',drive:'adventure'}] as const) {
  test(`${character}/${drive}: full production adventure maintains current probability ${drive==='adventure'?'through shop, rest and event':'through the first combat'}`, {timeout: 120_000}, async t => {
    const loaded = unwrap(await createCardLoader({controlled: true, recordCore: false}).load(cardDefinition));
    const instance = unwrap(await loaded.core.start({seed: '130', character, detailedEvents: true}));
    const game = unwrap(await createGameBinder().bind({instance, contract, persistence: loaded.persistence!}));
    const source = async () => unwrap(await game.fork!());
    registerCurrentSource(source, game);
    const events: StsEvent[] = [], searched = new Set<string>();
    const onEvent = async (delivery: {event: StsEvent}) => {
      events.push(delivery.event);
      return {kind: 'reply' as const, value: null};
    };
    let fought = false, rewarded = false, finished = false, previous = 'start';
    let random = {state: 76, position: 0};
    const initialize = CardProgram.prototype.initial;
    try {
      unwrap(await game.bind({player: '0', onRequest: async () => ({kind: 'pause'}), onEvent}));
      unwrap(await game.run());
      CardProgram.prototype.initial = function () { throw Error('Adventure continuation must not initialize or replay'); };
      for (let step = 0; step < 96; step++) {
        const before = unwrap(await game.inspect());
        if(before.kind==='ended'){
          assert.ok(fought,'the registered path must enter combat');
          assert.notEqual(drive,'r2','the added R2 development path must cover the reward window');
          const tracking=await withCurrentSource(source,inspectProbabilityTracking);
          assert.ok(tracking);assert.equal(tracking.mode,'current');assert.equal(tracking.phase,'waiting');
          assert.equal(tracking.worlds,0);assert.equal(tracking.account.captures,0);
          t.diagnostic('Original baseline reached a terminal outcome; this path provides no reward-window coverage.');
          finished=true;break;
        }
        assert.equal(before.kind, 'request', `adventure ended before returning to map after ${previous}`);
        if (before.kind !== 'request') throw Error('Expected original adventure request');
        const decision = publicDecision(before.requests[0]!, events.map(event => ({event})));
        const current = position(decision), observation = decision.observation;
        const window = drive==='adventure'&&observation.game.screen==='EVENT_SCREEN'&&observation.game.floor>0?'later-event':observation.battle ? 'combat' : observation.game.screen;
        const tracking = await withCurrentSource(source, inspectProbabilityTracking);
        assert.ok(tracking);
        assert.notEqual(tracking.phase, 'failed', `step ${step}, ${window}, after ${previous}: ${tracking.reason}`);
        assert.equal(tracking.mode,'current');assert.equal(tracking.worlds,0);assert.equal(tracking.account.captures,0);
        fought ||= window === 'combat';
        rewarded ||= fought && window === 'REWARDS';
        if (rewarded && window === 'MAP_SCREEN' && (drive!=='adventure'||['SHOP_ROOM','REST_ROOM','later-event'].every(key=>searched.has(key)))) { finished = true; break; }
        let bits = Number(baseline(current));
        if (!searched.has(window)||(drive==='r2'||drive==='adventure')&&window==='combat') {
          const resources = await openStsSearchBudget(source, {...defaultSearchLimits, mode: 'work', worlds: 4, decisions: 1, simulations: 64}, new AbortController().signal, 0);
          const adapter = createStsProbabilityContinuation();
          const domain: SearchDomain = {
            root: current, baseline, next: adapter.next,
            async current(cursor, budget) {
              const root = await adapter.take(source, events, budget);
              budget.accepted++;
              return {particles: [{current: root, weight: 1}], representation: adapter.representation(root), random: cursor, method: 'actual-current-probability', reason: null};
            },
          };
          try {
            const result = await search(domain, 'r2', random, resources.budget);
            t.diagnostic(`${window}: completed=${result.evidence.completed}, reason=${result.evidence.reason}, milliseconds=${result.cost.milliseconds.toFixed(1)}`);
            assert.ok(result.evidence.completed > 0, `${window}: ${result.evidence.reason}`);
            assert.ok(result.evidence.actions.some(action => action.outcomes.length > 0));
            random = result.random;
            assert.deepEqual(unwrap(await game.inspect()), before, 'search must leave the actual current unchanged');
            if((drive==='r2'||drive==='adventure')&&window==='combat')bits=contract.schemas.actions.action.action.parse(result.action).bits;
            searched.add(window);
          } finally { resources.close(); }
        }
        if(drive==='adventure'&&window==='MAP_SCREEN'){
          const desired=!searched.has('SHOP_ROOM')?'SHOP':!searched.has('REST_ROOM')?'REST':'EVENT';
          const distance=(x:number,y:number):number=>{
            const pending=[{x,y,steps:0}],seen=new Set<string>();
            while(pending.length){const at=pending.shift()!,key=at.x+','+at.y;if(seen.has(key))continue;seen.add(key);
              const node=observation.game.map.nodes.find(node=>node.x===at.x&&node.y===at.y);if(!node)continue;
              if(node.room===desired)return at.steps;
              for(const x of node.edges)pending.push({x,y:at.y+1,steps:at.steps+1});
            }
            return Infinity;
          };
          let best=Infinity;
          for(const action of decision.actions){const presented=describeAction(observation,action.bits);if(presented.kind!=='travel')continue;
            const steps=distance(Number(presented.details.x),Number(presented.details.y));if(steps<best){best=steps;bits=action.bits;}
          }
        }
        const selected=describeAction(observation,bits);previous=selected.label;
        unwrap(await game.bind({player: '0', onRequest: async () => ({kind: 'reply', value: {bits}}), onEvent}));
        assert.ok(unwrap(await game.run()).accepted, 'one original accepted input per step');
      }
      assert.ok(finished, 'the bounded development path must reach its registered stopping condition');
      if(drive==='adventure')for(const key of ['SHOP_ROOM','REST_ROOM','later-event'])assert.ok(searched.has(key),'missing adventure search at '+key);
      for (const window of ['EVENT_SCREEN', 'MAP_SCREEN', 'combat', ...(rewarded?['REWARDS']:[])]) assert.ok(searched.has(window), `missing nonzero search at ${window}`);
    } finally {
      CardProgram.prototype.initial = initialize;
      unwrap(await game.close());
    }
  });
}
