import type {SearchPosition} from '@bear-forge/policies';
import type {Observation} from '../game.schemas.ts';
import {describeAction, describeCard} from '../presentation.ts';
import {cards} from '../cards.ts';
import {potionId} from '../identifiers.ts';
import {publicKey, actionKey, type PublicDecision} from './information.ts';

export const evaluationVersion = 'sts-public-heuristic@2';
/** Strategy weights only. No predicted damage, rule reimplementation, or win probability. */
export function publicValue(o: Observation): number {
  if (o.heartDefeated) return 1;
  if (o.game.outcome === 0) return -1;
  if (o.game.outcome !== 1) return .8;
  const hp = o.battle?.player.hp ?? o.game.hp;
  const maxHp = o.battle?.player.maxHp ?? o.game.maxHp;
  const health = hp / Math.max(1, maxHp);
  const danger = Math.max(0, .35 - health);
  const keys = Number(o.game.keys.red) + Number(o.game.keys.green) + Number(o.game.keys.blue);
  const burden = o.game.deck.reduce((sum, card) => {
    const type = describeCard(card.id, card.upgraded).type;
    return sum + (type === cards.ASCENDERS_BANE.type || type === cards.BURN.type ? 1 : 0);
  }, 0);
  const enemies = o.battle?.monsters.reduce((sum, m) => sum + Math.max(0, m.hp) / Math.max(1, m.maxHp), 0) ?? 0;
  return Math.max(-.95, Math.min(.75, .3 * health - .6 * danger + .004 * o.game.floor + .04 * keys +
    .0001 * o.game.gold + .01 * o.game.potions.filter(p => p !== potionId.INVALID && p !== potionId.EMPTY_POTION_SLOT).length - .015 * burden - .04 * enemies));
}
export function position(decision: PublicDecision): SearchPosition {
  return {information: publicKey(decision), actions: decision.actions.map(action => ({key: actionKey(action), action})),
    value: publicValue(decision.observation), terminal: decision.observation.game.outcome !== 1,
    round: decision.observation.game.floor * 10000 + (decision.observation.battle?.turn ?? 0)};
}
export function baseline(p: SearchPosition): string {
  const {observation: o} = JSON.parse(p.information) as PublicDecision;
  let best = -Infinity, chosen = p.actions[0]?.key;
  for (const candidate of p.actions) {
    const bits = Number(candidate.key), a = describeAction(o, bits), b = o.battle;
    let score = 0;
    if (a.kind === 'play-card' && b) {
      const card = b.hand[bits & 65535]!, d = describeCard(card.id, card.upgraded);
      const incoming = b.intents?.reduce((n, intent) => n + intent.attackDamage * intent.hits, 0) ?? 0;
      score = 10 + (d.type === cards.ANGER.type ? 2 : d.type === cards.BARRICADE.type ? 3 : incoming > b.player.block ? 4 : 1) -
        .2 * Math.max(0, b.costs?.[String(bits)] ?? card.costForTurn);
      const target = b.monsters.find(m => m.index === ((bits >>> 16) & 8191));
      if (d.variant.target && target) score += 1 / Math.max(1, target.hp);
    } else if (a.kind === 'end-turn') score = -10;
    else if (a.kind === 'discard-potion') score = -20;
    else if (a.kind === 'drink-potion') score = b && b.player.hp < b.player.maxHp * .4 ? 15 : -12;
    else if (a.kind === 'confirm-engage') score = a.details.engage && b && b.player.hp > b.player.maxHp * .4 ? 2 : 0;
    else if (a.kind === 'take-key') score = 12;
    else if (a.kind === 'take-gold' || a.kind === 'take-relic' || a.kind === 'open-chest') score = 10;
    // The original rules keep an unclaimable reward visible. Do not keep
    // choosing that legal no-op forever when the public belt has no space.
    else if (a.kind === 'take-potion') score = o.game.potions.includes(potionId.EMPTY_POTION_SLOT) ? 5 : -15;
    else if (a.kind === 'take-card') score = o.game.deck.length < 22 ? 3 : -2;
    else if (a.kind === 'skip-card') score = 0;
    else if (a.kind === 'leave') score = -5;
    else if (a.kind === 'rest-option') {
      const option = Number(a.details.option), health = o.game.hp / o.game.maxHp;
      score = option === 0 ? (health < .55 ? 10 : -1) : option === 2 && !o.game.keys.red && o.game.act >= 3 ? 12 : option === 1 ? 5 : 0;
    } else if (a.kind === 'travel') {
      const node = o.game.map.nodes.find(n => n.x === a.details.x && n.y === a.details.y);
      score = node?.room === 'REST' && o.game.hp < .6 * o.game.maxHp ? 5 : node?.room === 'ELITE' && o.game.hp < .5 * o.game.maxHp ? -5 : 0;
      if (!o.game.keys.green && node?.x === o.game.map.burningEliteX && node?.y === o.game.map.burningEliteY) score += 3;
    }
    if (score > best) {best = score; chosen = candidate.key;}
  }
  if (chosen === undefined) throw Error('No legal baseline action');
  return chosen;
}
