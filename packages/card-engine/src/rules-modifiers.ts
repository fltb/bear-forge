import { handle } from './rules-internal.ts';
import { declareStatic,staticDefinitions,resolveDefinition } from './rules-module-internal.ts';
import type { Query,QueryRead } from './rules-query.types.ts';
import type { Component,Owned } from './rules-module.types.ts';
import type { Ability } from './rules-reactions.types.ts';
import {resolveOrder} from './rules-order.ts';
import type {RuleOrder} from './rules-order.types.ts';
import {captureQuerySelections} from './rules-queries.ts';
import type {EntityQuerySelection} from './rules-query.types.ts';
import type {Borrowed} from './rules.types.ts';
export type ModifierContext<I,O,E={}>={input:I;value:O;source:number;owner:number;environment:E;registration:number};
export type ModifierSpec<I,O,E>={
  transform:(read:QueryRead,context:Borrowed<ModifierContext<I,O,E>>)=>O|Borrowed<O>;
  reads?:readonly (Component<any>|Owned<Component<any>>)[];
  dependencies?:readonly Query<any,any>[];
  condition?:Query<ModifierContext<I,O,E>,boolean>;
  eligible?:'registered'|'captured'|Query<ModifierContext<I,O,E>,boolean>;
  order?:RuleOrder;
  selections?:readonly EntityQuerySelection<any,any,any,any>[];
};
export function modify<I,O,E={}>(target:Query<I,O>,spec:ModifierSpec<I,O,E>):Ability<E>{
  const targetMetadata=staticDefinitions.get(target);
  if(targetMetadata?.kind!=='query'||typeof spec.transform!=='function')throw Error('Modifier requires a query and pure transform');
  const ability=handle<Ability<E>>();declareStatic(ability,{kind:'ability',abilityKind:'modifier',target,transform:spec.transform,
    reads:Object.freeze([...(spec.reads??[])].map(resolveDefinition)),dependencies:Object.freeze([...(spec.dependencies??[])]),selections:captureQuerySelections(spec.selections),condition:spec.condition??null,eligible:spec.eligible??'registered',...resolveOrder(targetMetadata.ordering,spec.order)});return ability;
}
