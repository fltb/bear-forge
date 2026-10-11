import type { ProgramModule, IO } from '@bear-forge/contracts/core';
import type { z } from 'zod';
import { SetupSchema, StateSchema, RequestSchema, ActionSchema } from './resolution.schemas.ts';
import type { State, Action } from './resolution.schemas.ts';
export type Setup = z.infer<typeof SetupSchema>;
export type Ports = {
  decision: {
    kind: 'request';
    input: z.infer<typeof RequestSchema>;
    output: Action;
  };
};
const ports = {
  decision: {
    kind: 'request' as const,
    input: RequestSchema,
    output: ActionSchema
  }
};
export const program = {
  schemas: {
    setup: SetupSchema,
    result: StateSchema,
    ports
  },
  async run(setup: Setup, io: IO<Ports>) {
    const state: State = {
      hp: [10, 10],
      mana: 3,
      hands: [['F'], setup.variant === 'double-prevent' ? ['U1', 'U2'] : ['U']],
      deck: ['P', 'B', 'S', 'M', 'N'],
      discard: [[], []],
      board: [{
        id: 'W',
        owner: '0',
        hp: 2
      }, {
        id: 'L',
        owner: '1',
        hp: 2
      }, {
        id: 'G',
        owner: '1',
        hp: 3
      }],
      damage: 0,
      triggers: [],
      events: []
    };
    function emit(kind: string, value: string | null = null, owner: '0' | '1' | null = null) {
      state.events.push({
        key: 'event:' + state.events.length,
        kind,
        value,
        owner
      });
    }
    async function choose(player: '0' | '1', kind: string, options: Action[]) {
      if (options.length === 1) return options[0]!;
      return io.call({
        port: 'decision',
        input: {
          state,
          player,
          kind,
          options
        }
      });
    }
    async function response(kind: string, allowCounter = false, allowReturn = false) {
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
        const action = await io.call({
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
          emit('return', 'L2');
        }
      }
      return true;
    }
    state.mana -= 3;
    state.hands[0] = [];
    emit('cast', 'F');
    const resolves = await response('spell-response', setup.variant === 'counter', setup.variant === 'return-wolf');
    if (resolves) {
      for (let wave = 0; wave < 2; wave++) {
        if (wave === 0 && setup.variant === 'empty-first') {
          emit('empty-wave');
          continue;
        }
        const targets = state.board.map(u => ({
          kind: 'target' as const,
          value: u.id
        }));
        if (!targets.length) continue;
        const targetChoice = await choose('0', 'wave-' + wave + '-target', targets);
        const target = state.board.find(u => u.id === targetChoice.value)!;
        const owner = Number(target.owner);
        const prevents: Action[] = [{
          kind: 'prevent',
          value: null
        }, ...state.hands[owner]!.map(value => ({
          kind: 'prevent' as const,
          value
        }))];
        const prevent = await choose(target.owner, 'wave-' + wave + '-prevent', prevents);
        if (prevent.value !== null) {
          state.hands[owner] = state.hands[owner]!.filter(c => c !== prevent.value);
          state.discard[owner]!.push(prevent.value);
          emit('discard', prevent.value);
          if (setup.variant === 'fail-discard' && wave === 1) throw Error('Injected mid-resolution failure');
        } else {
          target.hp -= 2;
          state.damage += 2;
          emit('damage', target.id);
          if (target.hp <= 0) {
            const witness = state.board.find(u => u.id === 'W' && u.hp > 0);
            state.board = state.board.filter(u => u.id !== target.id);
            state.discard[owner]!.push(target.id);
            emit('death', target.id);
            if (witness && target.id !== 'W') {
              const trigger = {
                id: 'T' + (state.triggers.length + 1),
                source: witness.id,
                owner: witness.owner
              };
              state.triggers.push(trigger);
              emit('trigger', trigger.id);
            }
          }
        }
      }
      if (state.damage >= 2 && state.deck.length) {
        const viewed = state.deck.splice(0, 3);
        emit('look', viewed.join(','), '0');
        const choice = await choose('0', 'take', viewed.map(value => ({
          kind: 'take' as const,
          value
        })));
        state.hands[0].push(choice.value!);
        state.deck.push(...viewed.filter(c => c !== choice.value));
        emit('gain', choice.value, '0');
      }
    }
    state.discard[0].push('F');
    emit(resolves ? 'spell-ended' : 'countered', 'F');
    for (const trigger of [...state.triggers].reverse()) {
      await response('trigger-response');
      const choice = await choose(trigger.owner, 'beneficiary', [{
        kind: 'beneficiary',
        value: '0'
      }, {
        kind: 'beneficiary',
        value: '1'
      }]);
      state.hp[Number(choice.value)]!++;
      emit('trigger-completed', trigger.id);
    }
    return state;
  }
} satisfies ProgramModule<Setup, Ports, State>;
