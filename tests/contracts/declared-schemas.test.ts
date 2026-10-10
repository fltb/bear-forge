import test from 'node:test';
import { z } from 'zod';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import * as core from '../../packages/contracts/src/instance/schemas.ts';
import * as game from '../../packages/contracts/src/game/schemas.ts';
import * as runtime from '../../packages/contracts/src/loading/schemas.ts';
import * as capture from '../../packages/contracts/src/capture/schemas.ts';
import * as persistence from '../../packages/contracts/src/persistence/schemas.ts';
import * as doudizhu from '../../games/doudizhu/src/schemas.ts';
import { assertBoundarySchema } from '../support/schema-admission.ts';
import type { SchemaPolicy } from '../support/schema-admission.ts';
test('schema profile targets the pinned Zod implementation',()=>{
  const require=createRequire(import.meta.url);
  assert.equal(require('zod/package.json').version,'4.6.5');
});
// These domain predicates are explicitly approved in this test fixture.
// Production callback admission remains a separate controlled-build obligation.
const checks=new Set<object>([
  ...(doudizhu.StageSchema._zod.def.checks??[]),
  ...(doudizhu.PlaySchema._zod.def.checks??[]),
  ...(doudizhu.FrameSchema._zod.def.checks??[]),
]);
const policy:SchemaPolicy={checks,atoms:new Set([game.JsonValueSchema,runtime.CompiledProgramDataSchema.shape.content])};
for(const [groupName,group] of Object.entries({core,game,runtime,capture,persistence,doudizhu})){
  for(const [name,value] of Object.entries(group)){
    if(value instanceof z.ZodType){
      test(`${groupName}.${name} uses value-preserving schema structures`,()=>{
        assertBoundarySchema(value,policy);
      });
    }
  }
}
