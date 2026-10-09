import assert from 'node:assert/strict';
import { ActionSchema } from '../../games/doudizhu/src/schemas.ts';
import { classify, plays } from '../../games/doudizhu/src/patterns.ts';
const reversed={kind:'play',cards:[17,16],pattern:{kind:'rocket',high:17,length:1}};
assert.ok(ActionSchema.safeParse(reversed).success);
assert.ok(classify(reversed.cards).some(p=>p.kind==='rocket'));
assert.ok(!plays([16,17],null).some(a=>JSON.stringify(a)===JSON.stringify(reversed)));
console.log('COUNTEREXAMPLE: reverse rocket is schema-valid and classified legal, but absent from exact generated values');
