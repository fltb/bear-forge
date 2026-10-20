import assert from 'node:assert/strict';

export type Difference={path:string;expected:unknown;actual:unknown};
/** JSON state relation: preserve every field, array position, primitive and identity field. */
export function firstDifference(expected:unknown,actual:unknown,path='state'):Difference|null {
  if(Object.is(expected,actual))return null;
  if(expected===null || actual===null || typeof expected!=='object' || typeof actual!=='object')return {path,expected,actual};
  if(Array.isArray(expected)!==Array.isArray(actual))return {path,expected,actual};
  if(Array.isArray(expected) && Array.isArray(actual)) {
    if(expected.length!==actual.length)return {path:path+'.length',expected:expected.length,actual:actual.length};
    for(let i=0;i<expected.length;i++){const d=firstDifference(expected[i],actual[i],`${path}[${i}]`);if(d)return d;}
    return null;
  }
  const e=expected as Record<string,unknown>,a=actual as Record<string,unknown>;
  for(const key of Object.keys(e)) {
    if(!Object.hasOwn(a,key))return {path:path+'.'+key,expected:e[key],actual:undefined};
    const d=firstDifference(e[key],a[key],path+'.'+key);if(d)return d;
  }
  for(const key of Object.keys(a))if(!Object.hasOwn(e,key))return {path:path+'.'+key,expected:undefined,actual:a[key]};
  return null;
}
export function assertSameState(expected:unknown,actual:unknown,context:string) {
  const difference=firstDifference(expected,actual);
  assert.equal(difference,null,`${context}: ${JSON.stringify(difference)}`);
}
