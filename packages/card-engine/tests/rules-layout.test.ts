import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { rules,linkRules } from '../src/index.ts';
import { layoutDigest } from '../src/rules-digest.ts';
const {defineEffect,call,sequence}=rules;
const schemas={setup:z.number(),result:z.number(),ports:{}};

test('portable layout digest matches host SHA-256 on fixed vectors, Unicode and block boundaries',()=>{
  for(const text of ['', 'abc','中文与emoji😀','\ud800','a'.repeat(55),'a'.repeat(56),'b'.repeat(64),'c'.repeat(1000)])
    assert.equal(layoutDigest(text),createHash('sha256').update(text).digest('hex'));
});

test('layout identity is reproducible and includes literal arguments and local selection',()=>{
  const child=defineEffect<number,number>(b=>b.return(b.input));
  function build(literal:number,selectSecond=false){
    const entry=defineEffect<number,number>(b=>{const first=b.local<number>(),second=b.local<number>();return sequence(b.assign(first,call(child,literal)),b.assign(second,7),b.return(selectSecond?second:first));});
    return linkRules({id:'frozen-implementation',schemas,initialize:()=>({}),entry,definitions:[entry,child]});
  }
  assert.equal(build(3).id,build(3).id);
  assert.notEqual(build(3).id,build(4).id);
  assert.notEqual(build(3).id,build(3,true).id);
});

test('author namespace exposes no bare mutation, frame, private dispatcher or host-port constructor',()=>{
  for(const name of ['primitive','operation','createBuilder','portEffect','dispatchQueuedEvents','openScope','closeScope'])assert.equal(Object.hasOwn(rules,name),false);
  assert.deepEqual(Object.keys(rules).filter(name=>name.startsWith('define')).sort(),['defineCheckpoint','defineComponent','defineEffect','defineEntity','defineEvent','defineQuery','defineRules']);
});
