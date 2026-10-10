import test from 'node:test';
import { z } from 'zod';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import * as core from '../src/instance/instance.schemas.ts';
import * as game from '../src/game/game.schemas.ts';
import * as runtime from '../src/core/loading.schemas.ts';
import * as capture from '../src/instance/capture.schemas.ts';
import * as persistence from '../src/instance/persistence.schemas.ts';
import { assertBoundarySchema } from './support/schema-admission.ts';
import type { SchemaPolicy } from './support/schema-admission.ts';
test('schema profile targets the pinned Zod implementation',()=>{
  const require=createRequire(import.meta.url);
  assert.equal(require('zod/package.json').version,'4.6.5');
});
const policy:SchemaPolicy={checks:new Set(),atoms:new Set([game.JsonValueSchema,runtime.CompiledProgramDataSchema.shape.content])};
for(const [groupName,group] of Object.entries({core,game,runtime,capture,persistence})){
  for(const [name,value] of Object.entries(group)){
    if(value instanceof z.ZodType){
      test(`${groupName}.${name} uses value-preserving schema structures`,()=>{
        assertBoundarySchema(value,policy);
      });
    }
  }
}
