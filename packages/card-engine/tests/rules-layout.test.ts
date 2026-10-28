import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { rules,linkRules } from '../src/index.ts';
import { layoutDigest } from '../src/rules-digest.ts';
const {defineEffect,call,sequence}=rules;
const schemas={setup:z.number(),result:z.number(),ports:{}};

test('portable layout digest matches host SHA-256 on fixed vectors, Unicode and block boundaries',()=>{
  const vectors=['','abc','中文与emoji😀'];
  for(const length of [55,56,63,64,65,119,120,127,128,129]){
    vectors.push('a'.repeat(length),'b'.repeat(length-3)+'中','c'.repeat(length-4)+'😀');
  }
  for(const text of vectors)assert.equal(layoutDigest(text),createHash('sha256').update(text).digest('hex'));
});

test('portable layout digest replaces isolated surrogates and encodes every UTF-16 code-unit class',()=>{
  const vectors=['\ud800','\udfff','\ud800x\udc00','\ud800\ud800\udc00\udc00','\udbff\udfff',
    'a'.repeat(54)+'\ud800','b'.repeat(62)+'\udc00',
    Array.from({length:0x10000},(_,code)=>String.fromCharCode(code)).join('')];
  for(const text of vectors)assert.equal(layoutDigest(text),createHash('sha256').update(text).digest('hex'));
});

test('portable layout digest keeps long ASCII and mixed Unicode messages independent across calls',()=>{
  const ascii='a'.repeat(1_000_000),mixed='abc中文😀\ud800x\udc00'.repeat(16_384);
  for(const text of [ascii,mixed,ascii,''])assert.equal(layoutDigest(text),createHash('sha256').update(text).digest('hex'));
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
