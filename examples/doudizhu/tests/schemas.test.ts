import test from 'node:test';
import {z} from 'zod';
import * as schemas from '../src/schemas.ts';
import {assertBoundarySchema} from '../../../packages/contracts/tests/support/schema-admission.ts';
// Domain predicates approved for this fixture; production admission is separate.
const policy={checks:new Set<object>([
  ...(schemas.StageSchema._zod.def.checks??[]),
  ...(schemas.PlaySchema._zod.def.checks??[]),
  ...(schemas.FrameSchema._zod.def.checks??[]),
]),atoms:new Set<object>()};
for(const [name,schema] of Object.entries(schemas)){
  if(schema instanceof z.ZodType)test(`${name} uses value-preserving schema structures`,()=>{
    assertBoundarySchema(schema,policy);
  });
}
