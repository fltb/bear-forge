import { invoke, forEach, request } from '@bear-forge/card-engine';
import type { EffectDefinition, ResolutionContext } from '@bear-forge/card-engine';
import type { State, Action } from './resolution.schemas.ts';
import type { Setup, Ports } from './program.ts';
type Context = ResolutionContext<State, Ports>;
type Effect<A, R = void> = EffectDefinition<State, Ports, A, R>;
function emit(state: State, kind: string, value: string | null = null, owner: '0' | '1' | null = null) {
  state.events.push({
    key: 'event:' + state.events.length,
    kind,
    value,
    owner
  });
}
async function choose(context: Context, player: '0' | '1', kind: string, options: Action[]) {
  if (options.length === 1) return options[0]!;
  return request(context, {
    port: 'decision',
    input: {
      state: context.state,
      player,
      kind,
      options
    }
  });
}

const responseEffect: Effect<{ kind: string; allowCounter: boolean; allowReturn: boolean }, boolean> = {
  id: 'response-window', async run(context, input) {
    const state = context.state;
    const { kind, allowCounter, allowReturn } = input;
    for (const player of ['0', '1'] as const) {
      const options: Action[] = [{
        kind: 'pass',
        value: null
      }];
      if (player === '1' && allowCounter) options.push({
        kind: 'counter',
        value: null
      });
      if (player === '1' && allowReturn) options.push({
        kind: 'return',
        value: 'L'
      });
      const action = await request(context, {
        port: 'decision',
        input: {
          state,
          player,
          kind,
          options
        }
      });
      if (action.kind === 'counter') return false;
      if (action.kind === 'return') {
        state.board = state.board.filter(u => u.id !== 'L');
        state.board.push({
          id: 'L2',
          owner: '1',
          hp: 2
        });
        emit(state, 'return', 'L2');
      }
    }
    return true;
  }
};

const waveEffect: Effect<{ wave: number; setup: Setup }> = {
  id: 'damage-wave', async run(context, { wave, setup }) {
    const state = context.state;
    if (wave === 0 && setup.variant === 'empty-first') {
      emit(state, 'empty-wave');
      return;
    }
    const targets = state.board.map(u => ({
      kind: 'target' as const,
      value: u.id
    }));
    if (!targets.length) return;
    const targetChoice = await choose(context, '0', 'wave-' + wave + '-target', targets);
    const target = state.board.find(u => u.id === targetChoice.value)!;
    const owner = Number(target.owner);
    const prevents: Action[] = [{
      kind: 'prevent',
      value: null
    }, ...state.hands[owner]!.map(value => ({
      kind: 'prevent' as const,
      value
    }))];
    const prevent = await choose(context, target.owner, 'wave-' + wave + '-prevent', prevents);
    if (prevent.value !== null) {
      state.hands[owner] = state.hands[owner]!.filter(c => c !== prevent.value);
      state.discard[owner]!.push(prevent.value);
      emit(state, 'discard', prevent.value);
      if (setup.variant === 'fail-discard' && wave === 1) throw Error('Injected mid-resolution failure');
    } else {
      target.hp -= 2;
      state.damage += 2;
      emit(state, 'damage', target.id);
      if (target.hp <= 0) {
        const witness = state.board.find(u => u.id === 'W' && u.hp > 0);
        state.board = state.board.filter(u => u.id !== target.id);
        state.discard[owner]!.push(target.id);
        emit(state, 'death', target.id);
        if (witness && target.id !== 'W') {
          const trigger = {
            id: 'T' + (state.triggers.length + 1),
            source: witness.id,
            owner: witness.owner
          };
          state.triggers.push(trigger);
          emit(state, 'trigger', trigger.id);
        }
      }
    }
  }
};

const tailEffect: Effect<undefined> = {
  id: 'private-reward', async run(context) {
    const state = context.state;
    if (state.damage >= 2 && state.deck.length) {
      const viewed = state.deck.splice(0, 3);
      emit(state, 'look', viewed.join(','), '0');
      const choice = await choose(context, '0', 'take', viewed.map(value => ({
        kind: 'take' as const,
        value
      })));
      state.hands[0].push(choice.value!);
      state.deck.push(...viewed.filter(c => c !== choice.value));
      emit(state, 'gain', choice.value, '0');
    }
  }
};

const triggerEffect: Effect<State['triggers'][number]> = {
  id: 'captured-trigger', async run(context, trigger) {
    const state = context.state;
    await invoke(context, responseEffect, { kind: 'trigger-response', allowCounter: false, allowReturn: false });
    const choice = await choose(context, trigger.owner, 'beneficiary', [{
      kind: 'beneficiary',
      value: '0'
    }, {
      kind: 'beneficiary',
      value: '1'
    }]);
    state.hp[Number(choice.value)]!++;
    emit(state, 'trigger-completed', trigger.id);
  }
};

export const spellEffect: Effect<Setup, State> = {
  id: 'double-wave-spell', async run(context, setup) {
    const state = context.state;
    state.mana -= 3;
    state.hands[0] = [];
    emit(state, 'cast', 'F');
    const resolves = await invoke(context, responseEffect, {
      kind: 'spell-response', allowCounter: setup.variant === 'counter', allowReturn: setup.variant === 'return-wolf',
    });
    if (resolves) {
      await forEach(context, [{ wave: 0, setup }, { wave: 1, setup }], waveEffect);
      await invoke(context, tailEffect, undefined);
    }
    state.discard[0].push('F');
    emit(state, resolves ? 'spell-ended' : 'countered', 'F');
    await forEach(context, [...state.triggers].reverse(), triggerEffect);
    return state;
  }
};
