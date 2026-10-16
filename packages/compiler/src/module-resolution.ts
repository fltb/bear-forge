const dependencyResolutionFailure=Symbol('module dependency resolution failure');

/** An imported source fails to parse while the entry graph is being linked.
 * Preserve the original SyntaxError; the private marker records its phase. */
export function markDependencyResolutionError(error:SyntaxError):void{
  Object.defineProperty(error,dependencyResolutionFailure,{value:true});
}

export function isDependencyResolutionError(error:unknown):error is SyntaxError{
  return error instanceof SyntaxError&&(error as any)[dependencyResolutionFailure]===true;
}
