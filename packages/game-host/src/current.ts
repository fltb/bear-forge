import type {Instance,Outcome} from '@bear-forge/contracts/instance';

// Private composition capability, absent from the public BaseGame protocol.
// The binder checks its ownership and stable-boundary guards before forking.
const forks=new WeakMap<object,()=>Promise<Outcome<Instance<any,any>>>>();
export function registerCurrentFork(game:object,fork:()=>Promise<Outcome<Instance<any,any>>>):void {forks.set(game,fork);}
export async function forkGameCurrent(game:object):Promise<Instance<any,any>> {
  const fork=forks.get(game);
  if(!fork)throw Error('Game has no current Context capability');
  const result=await fork();
  if(!result.ok)throw Error(result.error.code+': '+result.error.message);
  return result.value;
}

// These callbacks expose ownership-checked resource operations, not a new
// public Instance/BaseGame method. The game keeps ownership of its live input.
const accessors=new WeakMap<object,<T>(operation:(instance:Instance<any,any>)=>Promise<T>)=>Promise<T>>();
const sources=new WeakMap<object,object>();
export function registerCurrentAccess(game:object,access:<T>(operation:(instance:Instance<any,any>)=>Promise<T>)=>Promise<T>):void{accessors.set(game,access);}
export function registerCurrentSource(source:object,game:object):void{sources.set(source,game);}
export async function withCurrentSource<T>(source:object,operation:(instance:Instance<any,any>)=>Promise<T>):Promise<T>{
  const game=sources.get(source),access=game&&accessors.get(game);
  if(!access)throw Error('Current source has no live resource capability');
  return access(operation);
}
