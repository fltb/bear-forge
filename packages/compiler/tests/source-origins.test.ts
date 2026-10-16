import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transformSync} from '@babel/core';
import {markCallableOrigins,materializeCallableOrigins,finalizeCallableOrigins,type SourceOrigins} from '../src/source-origins.ts';
import {captureLinkedSourceRanges} from '../src/source-metadata.ts';

const empty=():SourceOrigins=>({text:'',ranges:[],segments:[],remap:[]});
test('callable origins are deterministic across module read order and duplicate source content',()=>{
  const inputs={a:'const first = value=>value+1;',b:'class Second { method(){return 2;} }'};
  function build(order:('a'|'b')[]){
    const origins=empty(),marked=new Map<string,string>();
    for(const key of order)marked.set(key,markCallableOrigins(inputs[key],key+'.js',origins));
    // A second module may have exactly the same text. It must share metadata,
    // without making the first two modules' annotations depend on read order.
    markCallableOrigins(inputs.a,'duplicate.js',origins);
    finalizeCallableOrigins(origins);
    const code=transformSync(marked.get('a')+'\n'+marked.get('b'),{
      configFile:false,babelrc:false,plugins:[()=>materializeCallableOrigins(origins)]
    })!.code!;
    return {text:origins.text,ranges:origins.ranges,code};
  }
  assert.deepEqual(build(['a','b']),build(['b','a']));
});

test('source annotations preserve exact callable text and disappear before execution lowering',()=>{
  const source=`const arrow = x=>x+1;
    function ordinary(value=1){ /* original comment */ return value; }
    class Example { static /* excluded prefix */ method(){return 3;} }
    const object={['name'](){return 4;}};`;
  const origins=empty(),marked=markCallableOrigins(source,'source.js',origins);
  finalizeCallableOrigins(origins);
  const linked=transformSync(marked,{configFile:false,babelrc:false,
    plugins:[()=>materializeCallableOrigins(origins)]})!.code!;
  assert.doesNotMatch(linked,/\.callableSourceMarker\(/);
  const observed:string[]=[];
  const output=transformSync(linked,{
    configFile:false,babelrc:false,parserOpts:{tokens:true},
    plugins:[()=>captureLinkedSourceRanges(origins),()=>({visitor:{'Function|Class'(path:any){
      const [start,end]=path.node.extra.bearSourceRange;observed.push((origins.text+linked).slice(start,end));
    }}})]
  })!.code!;
  assert.deepEqual(observed,[
    'x=>x+1','function ordinary(value=1){ /* original comment */ return value; }',
    'class Example { static /* excluded prefix */ method(){return 3;} }','method(){return 3;}',"['name'](){return 4;}"
  ]);
  assert.doesNotMatch(output,/@bear-callable-source:/);
  assert.doesNotMatch(output,/static\s*\{/);
});

test('callable ownership survives inserted prologues without stealing nested origins',()=>{
  const origins:SourceOrigins={text:'outerinnerclass',ranges:[[0,5],[5,10],[10,15]],segments:[],remap:[]};
  const code=`function outer(){
    void 0;
    /*@bear-callable-source:0*/;
    return function inner(){void 1; /*@bear-callable-source:1*/;};
  }
  class Example { static { void 2; /*@bear-callable-source:2*/; void 3; } }`;
  const observed:number[][]=[];
  const output=transformSync(code,{configFile:false,babelrc:false,parserOpts:{tokens:true},
    plugins:[()=>captureLinkedSourceRanges(origins),()=>({visitor:{'Function|Class'(path:any){
      observed.push(path.node.extra.bearSourceRange);
    }}})]})!.code!;
  assert.deepEqual(observed,origins.ranges);
  assert.doesNotMatch(output,/@bear-callable-source:/);
  assert.match(output,/void 2;/);assert.match(output,/void 3;/);
});

test('duplicate and orphaned callable annotations fail compilation',()=>{
  const origins:SourceOrigins={text:'x',ranges:[[0,1]],segments:[],remap:[]};
  for(const code of [
    'function f(){/*@bear-callable-source:0*/; /*@bear-callable-source:0*/;}',
    'function f(){/*@bear-callable-source:0*/ /*@bear-callable-source:0*/;}',
    '/*@bear-callable-source:0*/;',
    'function f(){if(true){/*@bear-callable-source:0*/;}}',
    'class C {static{/*@bear-callable-source:0*/;} static{/*@bear-callable-source:0*/;}}'
  ])assert.throws(()=>transformSync(code,{configFile:false,babelrc:false,parserOpts:{tokens:true},
    plugins:[()=>captureLinkedSourceRanges(origins)]}),/source annotation/);
});
