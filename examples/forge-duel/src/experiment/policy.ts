import { cards } from '../index.ts';
import { createScript } from '@bear-forge/policies';
import type { PolicyRequest } from '@bear-forge/policies';
import type { Script } from './experiment.types.ts';
export function scoreAction(action: any, request: PolicyRequest) {
  const observation: any = request.observation,
    seat = request.player,
    enemy = seat === '0' ? '1' : '0';
  if (action.kind === 'end') return -100;
  if (action.kind === 'attack') {
    const unit = observation.heroes[seat].board.find((u: any) => u.id === action.unitId);
    if (action.target === 'hero:' + enemy) return observation.heroes[enemy].hp <= unit.attack ? 10000 : 10 + unit.attack;
    const target = observation.heroes[enemy].board.find((u: any) => u.id === action.target);
    return (target.hp <= unit.attack ? 30 : 0) + target.attack - (unit.hp <= target.attack ? unit.attack : 0);
  }
  const card = observation.hand.find((c: any) => c.id === action.cardId);
  if (!card) throw Error('Action card missing from legal observation');
  const rule = cards[card.definition as keyof typeof cards];
  if (rule.attack) return 20 + rule.attack + rule.hp;
  if (card.definition === 'repair') return Math.min(3, 20 - observation.heroes[seat].hp) - 10;
  if (card.definition === 'supply') return 5;
  if (action.target === 'hero:' + enemy) return observation.heroes[enemy].hp <= (card.definition === 'spark' ? 2 : 4) ? 10000 : 6;
  const target = observation.heroes[enemy].board.find((u: any) => u.id === action.target);
  return (target.hp <= (card.definition === 'spark' ? 2 : 4) ? 25 : 0) + target.attack;
}
export const policy = (name: Script) => createScript(name, name === 'rule' ? {
  score: scoreAction,
  version: 'forge-rule@1'
} : {});
