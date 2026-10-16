import {build} from 'esbuild';
// One loaded factory, private registries/jobs per invocation, shared host builtins untouched.
await build({entryPoints:['src/effects.cjs'],bundle:true,outfile:'dist/effects.cjs',platform:'node',format:'cjs',logLevel:'silent',banner:{js:`"use strict";module.exports=function createEffects(){
const host=globalThis;
return (function(){
const globalThis={};const global=globalThis;
for(const key of ['Object','Array','Number','String','Boolean','Math','JSON','Map','Set','Symbol','Reflect','Error','TypeError','RangeError','Function','RegExp','Date','Uint8Array','ArrayBuffer','DataView','WeakMap','WeakSet','Int8Array','Uint8ClampedArray','Int16Array','Uint16Array','Int32Array','Uint32Array','Float32Array','Float64Array','BigInt64Array','BigUint64Array'])globalThis[key]=host[key];
const __effectfulSerializationState=globalThis.__effectfulSerializationState={};
let Promise=host.Promise;
const process=undefined,console={log(){},warn(){},error(){}};
const unavailableTimer=()=>{throw new TypeError('Host timer is unavailable inside Program');};
const setTimeout=unavailableTimer,setInterval=unavailableTimer,clearTimeout=unavailableTimer,clearInterval=unavailableTimer;
const module={exports:{}};let exports=module.exports;
`},footer:{js:'return module.exports;})();};'}});
await build({entryPoints:['src/realm-runtime.ts'],bundle:true,outfile:'dist/realm-runtime.cjs',platform:'node',format:'cjs',logLevel:'silent'});
