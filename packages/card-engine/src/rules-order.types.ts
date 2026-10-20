/** Identity is the literal object reference, never its optional display label. */
export type RulePhase=Readonly<{label?:string}>;
export type PhaseConstraint={phase:RulePhase;before?:readonly RulePhase[];after?:readonly RulePhase[]};
export type RuleOrdering={phases:readonly PhaseConstraint[];default:RulePhase};
export type RuleOrder=number|RulePhase|{phase:RulePhase;priority?:number};
export type PreparedOrdering={phases:readonly RulePhase[];edges:readonly (readonly [number,number])[];default:number};
export type ResolvedOrder={phase:number;order:number};
