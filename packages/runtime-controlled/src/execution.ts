import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { copy } from '@bear-forge/boundary';
import { loadProgramFactory, programCapabilities } from '@bear-forge/runtime';
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
  if (x.format !== 1 || x.abi !== 'effectful-v2-main-3' || typeof x.code !== 'string' || typeof x.exportName !== 'string' || x.digest !== createHash('sha256').update(x.code).digest('hex')) throw new Error('Incompatible artifact');
  return x;
}
const require = createRequire(import.meta.url);
const artifactFactories = new WeakMap<Artifact, Function>();
/** Ordinary JS instance state; no separate VM/context/process. */
export class ProgramExecution {
  readonly effects: any;
  private module: any;
  private remaining: number;
  program: any;
  io: any;
  result: any;
  constructor(artifact: Artifact, budget = 1000000) {
    let factory = artifactFactories.get(artifact);
    if (!factory) {
      factory = loadProgramFactory(artifact.code);
      artifactFactories.set(artifact, factory);
    }
    this.remaining = budget;
    this.effects = require('../dist/effects.cjs')();
    const unavailable = (): never => {
      this.effects.State.context.__hostViolation = true;
      throw Error('Undeclared host effect');
    };
    const capabilities = programCapabilities(() => {
      if (--this.remaining < 0) {
        this.effects.State.context.__budgetExceeded = true;
        throw Error('budget exceeded');
      }
    }, unavailable);
    Object.assign(this.effects.globals, {
      Math: capabilities.Math,
      Function: capabilities.Function,
      globalThis: this.effects.globals,
      __zod_globalConfig: {
        jitless: true
      }
    });
    // The local Math facade is immutable code capability, not game state.
    this.effects.S.regOpaqueRec(capabilities.Math, 'program.Math', {
      descriptor: {
        props: false
      }
    });
    this.module = factory(this.effects, capabilities);
    this.program = this.module.exports[artifact.exportName];
    if (!this.program?.run || !this.program.schemas) throw Error('Artifact must export a ProgramModule');
  }
  private guard(action: () => any): any {
    const result = action();
    if (this.fault) throw Error('budget exceeded');
    if (this.hostViolation) throw Error('Undeclared host effect');
    return result;
  }
  admitSchemas() {
    this.guard(() => {
      this.effects.admitSchema(this.program.schemas.setup);
      this.effects.admitSchema(this.program.schemas.result);
      for (const port of Object.values(this.program.schemas.ports) as any[]) {
        this.effects.admitSchema(port.input);
        this.effects.admitSchema(port.output);
      }
    });
  }
  boundarySchemas(): any {
    const wrap = (schema: any) => new Proxy(schema, {
      get: (target, key) => key === 'parse' ? (value: unknown) => this.guard(() => target.parse(copy(value))) : Reflect.get(target, key)
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
  start(setup: unknown) {
    this.io = new this.effects.Device();
    this.result = this.program.run(copy(setup), this.io);
    this.effects.drain();
  }
  resume(output: unknown) {
    this.effects.reply(this.io, copy(output));
  }
  snapshot(): string {
    return this.effects.S.stringify({
      program: this.program,
      moduleExports: this.module.exports,
      io: this.io,
      result: this.result,
      suspended: this.effects.State.context.suspended,
      jobs: this.effects.jobs,
      remaining: this.remaining
    });
  }
  restore(data: string) {
    const restored = this.effects.S.parse(data);
    this.program = restored.program;
    this.module.exports = restored.moduleExports;
    this.io = restored.io;
    this.result = restored.result;
    this.effects.State.context.suspended = restored.suspended;
    this.effects.jobs.splice(0, this.effects.jobs.length, ...restored.jobs);
    this.remaining = restored.remaining;
  }
  get fault() {
    return this.effects.State.context.__budgetExceeded;
  }
  get hostViolation() {
    return this.effects.State.context.__hostViolation;
  }
}
