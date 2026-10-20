import type { Component,Owned,Schema } from './rules-module.types.ts';
import type { Effect,Input,Value } from './rules.types.ts';
import type {RuleOrder,RuleOrdering} from './rules-order.types.ts';
declare const kindBrand:unique symbol;
declare const entityBrand:unique symbol;
export type EntityKind<C,S=undefined>={readonly [kindBrand]:{config:C;setup:S}};
export type EntityDefinition<C,S=undefined>={readonly [entityBrand]:{config:C;setup:S}};
export type SpawnSpec<C,S=undefined>={owner:Input<number|null>;scope:Input<number>}&(undefined extends S?{setup?:Input<S>}:{setup:Input<S>})&(
  {definition:EntityDefinition<C,S>;kind?:EntityKind<C,S>}|{definition:Value<EntityDefinition<C,S>>;kind:EntityKind<C,S>}
);
export type EntityLifecycle<S=undefined>={entity:number;owner:number|null;scope:number}&(undefined extends S?{setup?:S}:{setup:S});
export type EntityKindSpec<C,S=undefined>={
  config:Schema<C>;
  components:readonly (Component<any>|Owned<Component<any>>)[];
  initialize?:Effect<EntityLifecycle<S>,void>;
  dispose?:Effect<Omit<EntityLifecycle<S>,'setup'>&{reason:unknown},void>;
}&(undefined extends S?{setup?:Schema<S>}:{setup:Schema<S>});
export type ScopeKind=Readonly<{label?:string;order?:RuleOrdering}>;
export type ScopeLifecycle={scope:number;parent:number|null};
export type LifecycleSpec={initialize?:Effect<ScopeLifecycle,void>;dispose?:Effect<ScopeLifecycle,void>;order?:RuleOrder};
export type LifecycleBinding={scope:ScopeKind;initialize:Effect<ScopeLifecycle,void>|null;dispose:Effect<ScopeLifecycle,void>|null;phase:number;order:number;sequence:number};
