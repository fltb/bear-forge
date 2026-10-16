import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exceptionMessage } from '../src/exception.ts';

test('exception diagnostics preserve primitives and native Error data without invoking application code', () => {
  for (const value of [undefined,null,true,7,3n,'message',Symbol('marker')]) assert.equal(exceptionMessage(value),String(value));
  for (const ErrorType of [Error,TypeError,RangeError,SyntaxError,ReferenceError,EvalError,URIError]) {
    assert.equal(exceptionMessage(new ErrorType('message')),`${ErrorType.name}: message`);
  }
  assert.equal(exceptionMessage(new AggregateError([],'message')),'AggregateError: message');
  let calls=0;
  const trap=()=>{calls++;throw Error('must not run');};
  const error=new Error('original');
  Object.defineProperties(error,{name:{get:trap},message:{get:trap},stack:{get:trap},toString:{value:trap},[Symbol.toPrimitive]:{value:trap}});
  assert.equal(exceptionMessage(error),'Error');
  Object.setPrototypeOf(error,new Proxy({}, {get:trap,getPrototypeOf:trap,getOwnPropertyDescriptor:trap}));
  assert.equal(exceptionMessage(error),'Error');
  const opaque={toString:trap,[Symbol.toPrimitive]:trap};
  assert.equal(exceptionMessage(opaque),'Thrown object');
  assert.equal(exceptionMessage(new Proxy(opaque,{get:trap,getPrototypeOf:trap,getOwnPropertyDescriptor:trap})),'Thrown object');
  const revoked=Proxy.revocable({},{});revoked.revoke();
  assert.equal(exceptionMessage(revoked.proxy),'Thrown object');
  assert.equal(exceptionMessage(trap),'Thrown function');
  assert.equal(calls,0);
});
