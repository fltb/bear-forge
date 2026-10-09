import { z } from 'zod';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import * as core from '../packages/contracts/src/core/schemas.ts';
import * as game from '../packages/contracts/src/game/schemas.ts';
import * as runtime from '../packages/contracts/src/runtime/schemas.ts';
import * as doudizhu from '../games/doudizhu/src/schemas.ts';
import { assertBoundarySchema } from './schema_admission.ts';
import type { SchemaPolicy } from './schema_admission.ts';
const require=createRequire(import.meta.url);
assert.equal(require('zod/package.json').version,'4.6.5');
// These exact source revisions contain the three reviewed pure cross-field predicates.
const reviewedSources:Record<string,string>={'games/doudizhu/src/schemas.ts':'69bdaa2a27aa92689448c380c9a64d832c09416d6e3c21ee8567ff284a2acab4'};
for(const [path,expected] of Object.entries(reviewedSources))assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),expected,`${path}: re-review custom check purity after source changes`);
const checks=new Set<object>([
  ...(doudizhu.StageSchema._zod.def.checks??[]),
  ...(doudizhu.PlaySchema._zod.def.checks??[]),
  ...(doudizhu.FrameSchema._zod.def.checks??[]),
]);
const policy:SchemaPolicy={checks,atoms:new Set([game.JsonValueSchema,runtime.CompiledProgramDataSchema.shape.content])};
let count=0;
for(const group of [core,game,runtime,doudizhu])for(const [name,value] of Object.entries(group)){
  if(value instanceof z.ZodType){
    try{assertBoundarySchema(value,policy);count++;}catch(error){throw new Error(`${name}: ${String(error)}`);}
  }
}
console.log(`PASS: ${count} public/game schemas satisfy the pinned value-preserving structural profile`);
console.log('LIMIT: genuine admitted Zod instances and reviewed callback provenance are prerequisites; runtime must use value-equality validation, not arbitrary parse calls.');
