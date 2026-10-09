import type { Core, IO, PortCall, PortReturn, ProgramModule, InstancePersistence, InstanceCapture } from '../../packages/contracts/src/core/types.ts';
import { z } from 'zod';

type Ports = {
  read: { input: { key: string }; output: number };
  announce: { input: { message: string }; output: null };
};
const schema = {
  setup: z.string(), result: z.number(),
  ports: {
    read: { input: z.strictObject({ key: z.string() }), output: z.number() },
    announce: { input: z.strictObject({ message: z.string() }), output: z.null() },
  },
};
export const program: ProgramModule<string, Ports, number> = {
  schemas: schema,
  async run(key, io) {
    // Locals, branches, loops and recursive calls use TS; only external calls use IO.
    const visit = async (n: number): Promise<number> => {
      if (n === 0) return 0;
      const value = await io.call({ port: 'read', input: { key } });
      return value + await visit(n - 1);
    };
    let total = 0;
    for (let i = 0; i < 2; i++) total += await visit(i);
    await io.call({ port: 'announce', input: { message: String(total) } });
    return total;
  },
};
export async function consume(
  core: Core<string, Ports, number>,
  persistence: InstancePersistence<Ports, number>,
  capture: InstanceCapture<string, Ports, number>,
) {
  const start = await core.start('key');
  if (!start.ok) return;
  const instance = start.value;
  if(instance.fork){
    const branch=await instance.fork();
    if(branch.ok){const same:typeof instance=branch.value;await same.inspect();await same.close();}
  }
  const saved = await persistence.save(instance);
  if (saved.ok) {
    const restored = await persistence.restore(saved.value);
    if (restored.ok) await restored.value.inspect();
    await persistence.release(saved.value);
  }
  await capture.read(instance.id, { after: null, limit: 10 });
  await instance.close();
  await capture.read(instance.id, { after: null, limit: 10 });
  await capture.release(instance.id);
}
export function invalid(io: IO<Ports>, uncertain: 'read' | 'announce') {
  // @ts-expect-error registered names only
  void io.call({ port: 'clock', input: {} });
  // @ts-expect-error correlated port argument
  void io.call({ port: 'read', input: { message: 'hello' } });
  // @ts-expect-error union key cannot erase argument correlation
  void io.call({ port: uncertain, input: { key: 'a' } });
  // @ts-expect-error return belongs to its registered port
  const reply: PortReturn<Ports> = { port: 'read', output: null };
  // @ts-expect-error open registries do not declare a finite callable port set
  const wide: PortCall<Record<string, { input: number; output: number }>> = { port: 'a', input: 1 };
  // @ts-expect-error optional ports are not fixed contracts
  const optional: PortCall<{ a?: { input: number; output: number } }> = { port: 'a', input: 1 };
  void [reply, wide, optional];
}

type Left={left:{input:1;output:1}};
type Right={right:{input:2;output:2}};
// @ts-expect-error a union of tables is not a single registered table
const unionTable:PortCall<Left|Right>={port:'left',input:1};void unionTable;
// @ts-expect-error numeric keys are excluded, not silently erased from the table
const numeric:PortCall<{0:{input:1;output:1}}>={port:'0',input:1};void numeric;
declare const key:unique symbol;
// @ts-expect-error symbol keys cannot become protocol names
const symbol:PortCall<{[key]:{input:1;output:1}}>={port:'key',input:1};void symbol;

export async function boundExecution(core:Core<string,Ports,number>) {
  const started=await core.start('key');if(!started.ok)return;
  const instance=started.value;
  // @ts-expect-error advancement is only through run with a bound callback
  instance.resume;
  await instance.bind({
    async read(request,control){
      const key:string=request.input.key;void key;
      if(control.signal.aborted)return {kind:'pause'};
      return {kind:'reply',value:3};
    },
    async announce(request){
      const message:string=request.input.message;void message;
      return {kind:'reply',value:null};
    },
  });
  const result=await instance.run({limits:{maxReplies:2}});
  if(result.ok&&result.value.kind==='paused')await instance.inspect();
  // @ts-expect-error handler return must match its port
  await instance.bind({read:async()=>({kind:'reply',value:null})});
  // @ts-expect-error callbacks must explicitly reply or pause
  await instance.bind({read:async()=>3});
  // @ts-expect-error only declared ports can be bound
  await instance.bind({clock:async()=>({kind:'pause'})});
  await instance.bind(null);
  const transferred=await instance.transfer();
  if(transferred.ok){const same:typeof instance=transferred.value;await same.close();}
}
