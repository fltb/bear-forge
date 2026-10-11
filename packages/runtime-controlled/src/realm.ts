import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { deserialize, serialize } from 'node:v8';
import { copy } from '@bear-forge/boundary';
import type { CompiledProgram } from '@bear-forge/contracts/loading';
import type { PortShape } from '@bear-forge/contracts/core';
export type Artifact = {
  format: 1;
  abi: string;
  code: string;
  digest: string;
  exportName: string;
};
export function digest(content: Uint8Array) {
  return createHash('sha256').update(content).digest('hex');
}
export function decode(content: Uint8Array): Artifact {
  if (!(content instanceof Uint8Array) || content.byteLength > 32 * 1024 * 1024) throw new Error('Invalid artifact');
  const x = JSON.parse(new TextDecoder().decode(content));
  if (x.format !== 1 || x.abi !== 'effectful-v2-static-2' || typeof x.code !== 'string' || typeof x.exportName !== 'string' || x.digest !== createHash('sha256').update(x.code).digest('hex')) throw new Error('Incompatible artifact');
  return x;
}
let runtimeCode: string | undefined;
let runtimeScript: vm.Script | undefined;
const scripts = new Map<string, vm.Script>();
export class Realm {
  readonly context: vm.Context;
  readonly effects: any;
  program: any;
  io: any;
  result: any;
  constructor(artifact: Artifact, budget = 1000000) {
    runtimeCode ??= readFileSync(fileURLToPath(new URL('../dist/effects.cjs', import.meta.url)), 'utf8');
    this.context = vm.createContext({}, {
      codeGeneration: {
        strings: false,
        wasm: false
      }
    });
    vm.runInContext(`global=globalThis;console={log(){},warn(){},error(){}};
      function unavailable(){const error=Error('Undeclared host effect');if(typeof effects!=='undefined')effects.State.context.__hostViolation??=error.stack;throw error;}
      Math.random=unavailable;Date.now=unavailable;
      setTimeout=clearTimeout=setInterval=clearInterval=setImmediate=clearImmediate=queueMicrotask=unavailable;
      module={exports:{}};exports=module.exports;
      function require(name){if(name==='path')return {join(...parts){return parts.join('/')}};if(name==='effects')return effects;throw Error('Undeclared module '+name);}`, this.context);
    runtimeScript ??= new vm.Script(runtimeCode);
    runtimeScript.runInContext(this.context, {
      timeout: 1000
    });
    this.effects = this.context.module.exports;
    this.context.effects = this.effects;
    vm.runInContext("module={id:'program',exports:{}};exports=module.exports", this.context);
    this.context.__remaining = budget;
    this.context.__exportName = artifact.exportName;
    vm.runInContext(`function __tick(){if(--__remaining<0){effects.State.context.__budgetExceeded=true;throw new Error('budget exceeded');}}`, this.context);
    let script = scripts.get(artifact.digest);
    if (!script) {
      script = new vm.Script(artifact.code);
      if (scripts.size >= 4) scripts.delete(scripts.keys().next().value!);
      scripts.set(artifact.digest, script);
    }
    script.runInContext(this.context, {
      timeout: 10000
    });
    this.program = this.context.module.exports[artifact.exportName];
    this.context.__program = this.program;
    if (!this.program?.run || !this.program.schemas) throw new Error('Artifact must export a ProgramModule');
  }
  private guard(source: string): any {
    try {
      const value = vm.runInContext(source, this.context, {
        timeout: 1000
      });
      if (this.fault) throw Error('budget exceeded');
      return value;
    } catch (error) {
      if ((error as any)?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') this.effects.State.context.__budgetExceeded = true;
      throw error;
    }
  }
  admitSchemas() {
    this.guard('effects.admitSchema(__program.schemas.setup);effects.admitSchema(__program.schemas.result);for(const port of Object.values(__program.schemas.ports)){effects.admitSchema(port.input);effects.admitSchema(port.output);}');
  }
  boundarySchemas(): any {
    const wrap = (schema: any) => new Proxy(schema, {
      get: (target, key) => key === 'parse' ? (value: unknown) => {
        this.context.__validationSchema = target;
        this.context.__validationValue = this.import(value);
        try {
          return this.guard('__validationSchema.parse(__validationValue)');
        } finally {
          delete this.context.__validationSchema;
          delete this.context.__validationValue;
        }
      } : Reflect.get(target, key)
    });
    const schemas = this.program.schemas;
    return {
      ...schemas,
      setup: wrap(schemas.setup),
      result: wrap(schemas.result),
      ports: Object.fromEntries(Object.entries(schemas.ports).map(([key, port]: [string, any]) => [key, {
        ...port,
        input: wrap(port.input),
        output: wrap(port.output)
      }]))
    };
  }
  /** Convert plain boundary graphs to objects with this realm's prototypes. */
  import(value: unknown): any {
    const encoded = serialize(copy(value)).toString('base64');
    // v8 deserialization runs outside the realm; recursively rebuild descriptors.
    const raw = deserialize(Buffer.from(encoded, 'base64'));
    this.context.__incoming = raw;
    const result = vm.runInContext(`(function clone(value,seen=new Map()){
      if(value===null||typeof value!=='object')return value;if(seen.has(value))return seen.get(value);
      const out=Array.isArray(value)?new Array(value.length):{};seen.set(value,out);
      for(const key of Reflect.ownKeys(value)){if(key==='length'&&Array.isArray(value))continue;
      Object.defineProperty(out,key,{value:clone(value[key],seen),enumerable:true,writable:true,configurable:true});}return out;
    })(__incoming)`, this.context);
    delete this.context.__incoming;
    return result;
  }
  start(setup: unknown) {
    this.io = new this.effects.Device();
    this.context.__io = this.io;
    this.context.__setup = this.import(setup);
    this.result = vm.runInContext(`__result=module.exports[${JSON.stringify(this.context.__exportName ?? 'program')}].run(__setup,__io)`, this.context, {
      timeout: 1000
    });
    vm.runInContext('effects.drain()', this.context, {
      timeout: 1000
    });
  }
  resume(output: unknown) {
    this.context.__reply = this.import(output);
    vm.runInContext('effects.reply(__io,__reply)', this.context, {
      timeout: 1000
    });
  }
  snapshot(): string {
    return vm.runInContext('effects.S.stringify({program:__program,moduleExports:module.exports,io:__io,result:__result,suspended:effects.State.context.suspended,jobs:effects.jobs,remaining:__remaining})', this.context);
  }
  restore(data: string) {
    this.context.__snapshot = data;
    vm.runInContext('const restored=effects.S.parse(__snapshot);__program=restored.program;module.exports=restored.moduleExports;exports=module.exports;__io=restored.io;__result=restored.result;effects.State.context.suspended=restored.suspended;effects.jobs.splice(0,effects.jobs.length,...restored.jobs);__remaining=restored.remaining;', this.context);
    this.io = this.context.__io;
    this.result = this.context.__result;
    this.program = this.context.__program;
  }
  get fault() {
    return this.effects.State.context.__budgetExceeded;
  }
  get hostViolation() {
    return this.effects.State.context.__hostViolation;
  }
}
