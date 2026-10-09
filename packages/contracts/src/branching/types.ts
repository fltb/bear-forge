import type {Outcome,InstanceError} from '../instance/types.ts';
export type Branching<S,E=InstanceError>={fork:()=>Promise<Outcome<S,E>>};
