import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createGameSDK } from '@bear-forge/game-sdk';
import type { IO, PortCall, Program } from '@bear-forge/contracts/core';
import type { GamePortDeclarations, GameSDK } from '@bear-forge/contracts/authoring';

type P={ask:{kind:'request';input:number;output:number};event:{kind:'event';input:number[];output:null}};
const ports={ask:{kind:'request',input:z.number(),output:z.number()},event:{kind:'event',input:z.array(z.number()),output:z.null()}} satisfies GamePortDeclarations<P>;
const ioFor=(trace:unknown[],increment:number):IO<P>=>({
  async call<A extends PortCall<P>>(call:A):Promise<P[A['port']]['output']>{
    trace.push(structuredClone(call));
    return (call.port==='ask'?call.input+increment:null) as P[A['port']]['output'];
  },
});

// The recursive author program has the same native trace with explicit IO and
// the packaged SDK. No continuation or snapshot provider is simulated here.
const author=(make:(io:IO<P>)=>GameSDK<P>):Program<number,P,number>=>async(count,io)=>{
  const sdk=make(io);
  let total=0;
  async function resolve(depth:number):Promise<number>{
    const before=depth;
    const selected=await sdk.ask(total+depth);
    total+=selected;
    if(depth>0)return before+await resolve(depth-1);
    return selected;
  }
  for(let i=0;i<count;i++)await sdk.event([await resolve(2),total]);
  return total;
};
test('packaged SDK preserves recursive/looping native IO trace and result',async()=>{
  const directTrace:unknown[]=[],sdkTrace:unknown[]=[];
  const direct=author(io=>({ask:input=>io.call({port:'ask',input}),event:input=>io.call({port:'event',input})}));
  const wrapped=author(io=>createGameSDK<P>(io,ports));
  const [a,b]=await Promise.all([direct(3,ioFor(directTrace,1)),wrapped(3,ioFor(sdkTrace,1))]);
  assert.equal(a,b);assert.deepEqual(sdkTrace,directTrace);
  assert.equal(sdkTrace.length,12);
});
test('SDK construction is inert; instances retain their own IO bindings',async()=>{
  const left:unknown[]=[],right:unknown[]=[];
  const a=createGameSDK<P>(ioFor(left,1),ports),b=createGameSDK<P>(ioFor(right,10),ports);
  assert.deepEqual(left,[]);assert.deepEqual(right,[]);
  assert.deepEqual(Object.keys(a).sort(),['ask','event']);assert.ok(Object.isFrozen(a));
  assert.equal(await a.ask(2),3);assert.equal(await b.ask(2),12);
  await a.event([3]);assert.equal(left.length,2);assert.equal(right.length,1);
  assert.equal('bind' in a,false);assert.equal('fork' in a,false);
});
test('SDK does not settle a wait, copy payloads or consume IO errors',async()=>{
  const failure=new Error('IO failed');
  let release!:(value:number)=>void;
  const pending=new Promise<number>(resolve=>{release=resolve;});
  let received:unknown;
  const io:IO<P>={call:((call:PortCall<P>)=>{
    received=call.input;
    return call.port==='ask'?pending:Promise.reject(failure);
  }) as IO<P>['call']};
  const sdk=createGameSDK<P>(io,ports);
  assert.equal(sdk.ask(1),pending);release(7);assert.equal(await pending,7);
  const payload=[4];await assert.rejects(sdk.event(payload),error=>error===failure);
  assert.equal(received,payload); // actual boundary isolation is owned by IO
});
test('finite string names such as __proto__ and constructor remain real declared ports',async()=>{
  type Names={'__proto__':P['ask'];constructor:P['ask']};
  const declarations={['__proto__']:ports.ask,constructor:ports.ask} satisfies GamePortDeclarations<Names>;
  const io:IO<Names>={call:async call=>call.input+1};
  const sdk=createGameSDK<Names>(io,declarations);
  assert.equal(Object.getPrototypeOf(sdk),null);
  assert.equal(await sdk.__proto__(4),5);assert.equal(await sdk.constructor(5),6);
});
