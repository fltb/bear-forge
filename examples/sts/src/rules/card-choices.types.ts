import type {rules} from './execution.ts';
export type CardChoicePlayer={battle:number;screen:number;skipIndex?:number|undefined;indices?:number[]|undefined};
export type PendingCardChoice=CardChoicePlayer&{cards:number[];minimum?:number|undefined;maximum?:number|undefined;multiple?:boolean|undefined};
export type CardChoiceInput=CardChoicePlayer&{cards:readonly number[]};
export type CardManyInput=CardChoiceInput&{minimum:number;maximum:number};
export type CardChosen=CardChoicePlayer&{card:number;index:number;interactive:boolean};
export type CardSelection=CardChoicePlayer&{cards:number[];selectedIndices:number[];interactive:boolean;bits:number};
export type CardChoiceExports={one:rules.Effect<CardChoiceInput,number|null>;many:rules.Effect<CardManyInput,readonly number[]>;pending:rules.Query<number,PendingCardChoice|null>;chosen:rules.RuleEvent<CardChosen>;selected:rules.RuleEvent<CardSelection>;requesting:rules.RuleEvent<PendingCardChoice>};
