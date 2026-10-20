import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ReferenceClient} from './client.ts';
import {assertSameState} from './compare.ts';
import {revision} from './build.ts';
import type {Trace} from './play.ts';

export async function replay(trace:Trace,{requireHeart=true}={}) {
  assert.equal(trace.reference,revision,'Reference revision mismatch');
  assert.equal(trace.character,'IRONCLAD');assert.equal(trace.ascension,20);
  const ref=await ReferenceClient.create();
  try {
    let s=await ref.call({op:'start',seed:trace.seed});
    const act3Bosses=new Set<number>();let act4Elite=false;
    const visit=()=>{
      if(s.battle && s.game.act===3 && s.game.room==='BOSS')act3Bosses.add(s.battle.encounter);
      if(s.battle && s.game.act===4 && s.game.room==='ELITE')act4Elite=true;
    };
    visit();
    for(const [index,action] of trace.actions.entries()) {
      assert.equal(action.kind,s.battle?'battle':'game',`Wrong boundary at ${index}`);
      assert.equal(await ref.call<boolean>({op:'validate',bits:action.bits}),true,`Illegal action at ${index}`);
      s=await ref.call({op:'advance',bits:action.bits});
      visit();
    }
    if(trace.final)assertSameState(trace.final,s,`seed=${trace.seed} final`);
    assert.equal(s.heartDefeated,trace.heartDefeated);
    if(requireHeart) {
      assert.equal(s.heartDefeated,true,'A complete Heart win is required');
      assert.equal(s.game.outcome,2);assert.equal(s.game.act,4);
      assert.deepEqual(s.game.keys,{red:true,green:true,blue:true});
      assert.equal(act3Bosses.size,2,'Both A20 Act 3 bosses must have actually been fought');
      assert.equal(act4Elite,true,'Act 4 elite must have actually been fought');
    }
    return s;
  }finally{await ref.close();}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const file=process.argv[2];if(!file)throw Error('A full trace file is required');
  const path=resolve(process.env.INIT_CWD??process.cwd(),file);
  const s=await replay(JSON.parse(await readFile(path,'utf8')) as Trace,{requireHeart:!process.argv.includes('--allow-incomplete')});
  process.stdout.write(JSON.stringify({seed:s.game.seed,decisions:s.decisions,heartDefeated:s.heartDefeated,act:s.game.act,floor:s.game.floor})+'\n');
}
