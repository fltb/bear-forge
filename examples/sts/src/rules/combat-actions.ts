import {rules} from './execution.ts';
/** Static identity shared by combat modules; tasks and their lifetime remain in Context. */
export const actionQueue:rules.RuleQueue={label:'sts-actions'};
export const combatScope:rules.ScopeKind={label:'sts-combat'};
/** Contains only cancel-on-victory tasks; content entities live in the parent combat scope. */
export const combatActionScope:rules.ScopeKind={label:'sts-combat-actions'};
