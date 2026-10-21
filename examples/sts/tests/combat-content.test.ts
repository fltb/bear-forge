import test from 'node:test';
import assert from 'node:assert/strict';
import {CardProgram,CardMachine,plainCardStorage} from '@bear-forge/card-engine';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {combatContentDefinition,type CombatContentCase} from './combat-content-fixture.ts';
import {oracleViewOf} from './state-inspection.ts';
import {ReferenceClient,type RefAction} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';
import {commonRelicPool,uncommonRelicPool,rareRelicPool,bossRelicPool,shopRelicPool,ironcladPotions} from '../src/pools.ts';
import {encounterContent} from "../src/content/enemies/encounters.ts";
import {encounterId,potionId,relicId,type RelicId} from '../src/identifiers.ts';
import type {Frame} from '../src/game.schemas.ts';

const program=new CardProgram(combatContentDefinition);
function driver(input:CombatContentCase,controlled:boolean){
  const root=program.initial(input,100_000_000),storage=controlled?privateCardGraph(root):plainCardStorage(root),machine=new CardMachine(program,storage);let stop=machine.advance();
  const frame=():Frame=>{while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);if(stop.kind==='done')return stop.result;if(stop.kind!=='call'||stop.call.port!=='decision')throw Error(JSON.stringify(stop));return stop.call.input;};
  return{machine,frame,advance(bits:number){stop=machine.advance({bits});return frame();},close(){storage.close?.();}};
}
const base=():CombatContentCase=>({seed:'130',encounter:encounterId.CULTIST,relics:[],potion:null,durable:true,elite:false});

async function exercise(input:CombatContentCase,label:string){
  const ref=await ReferenceClient.create(),native=driver(input,false),controlled=driver(input,true);
  try{
    let source=await ref.call({op:'combatContentStart',...input,relics:input.relics.map(id=>relicId[id])}),turns=0,decisions=0,used=false;
    for(;;){
      for(const d of [native,controlled]){
        const frame=d.frame(),state=oracleViewOf(combatContentDefinition,d.machine.root.state,frame);
        assertSameState(source.battle,state.battle,`${label} decision=${decisions} battle`);
        if(source.battle)assert.deepEqual(frame.actions.map(a=>a.bits),source.actions.map(a=>a.bits),`${label} complete legal domain`);
        else for(const key of ['hp','maxHp','gold','deck','deckCounts','upgradeableCount','transformableCount','relics','potions','potionCount'] as const)assertSameState(source.game[key],state.game[key],`${label} persistent ${key}`);
      }
      if(!source.battle||turns>=9)break;
      assert.ok(++decisions<500,`${label} must make progress`);
      let action=source.actions.at(-1);
      if(source.battle.input===1){
        const potion:RefAction|undefined=input.potion!==null&&!used?source.actions.find(a=>a.type===1&&a.source===0):undefined;
        if(potion){action=potion;used=true;}else action=source.actions.find(a=>a.type===0)??source.actions.find(a=>a.type===4);
        if(action?.type===4)turns++;
      }
      assert.ok(action,`${label} must expose a continuation`);
      native.advance(action.bits);controlled.advance(action.bits);source=await ref.call({op:'advance',bits:action.bits});
    }
    if(input.potion!==null&&input.potion!==potionId.FAIRY_POTION)assert.equal(used,true,`${label} must actually consume the subject potion`);
    if(input.potion===potionId.FAIRY_POTION)assert.equal(source.game.potionCount,0,`${label} must actually trigger its automatic revival`);
  }finally{native.close();controlled.close();await ref.close();}
}

test('every production encounter executes opening, attacks, skills and nine enemy turns in both modes against C++',async t=>{
  assert.equal(new Set(encounterContent.exports.definitions.map(x=>x.id)).size,encounterContent.exports.definitions.length);
  for(const {id} of encounterContent.exports.definitions)await t.test(`encounter=${id}`,()=>exercise({...base(),encounter:id},`encounter=${id}`));
});

test('every Ironclad potion executes normal and Sacred Bark behavior through the actual potion/action pipeline',async t=>{
  for(const id of ironcladPotions)for(const bark of [false,true])await t.test(`${id} bark=${bark}`,()=>exercise({...base(),potion:potionId[id],relics:bark?['SACRED_BARK']:[]},`${id} bark=${bark}`));
});

// These have an acquisition selection/reward continuation. They belong to the
// acquisition matrix, rather than being installed with their effects bypassed.
export const acquisitionScreens:readonly RelicId[]=['ASTROLABE','BOTTLED_FLAME','BOTTLED_LIGHTNING','BOTTLED_TORNADO','CAULDRON','CALLING_BELL','DOLLYS_MIRROR','EMPTY_CAGE','ORRERY','TINY_HOUSE'];
test('Ironclad relic pool acquisition and combat hooks use real definitions through nine turns',async t=>{
  const ids=[...new Set<RelicId>([...commonRelicPool,...uncommonRelicPool,...rareRelicPool,...bossRelicPool,...shopRelicPool,'BURNING_BLOOD','NEOWS_LAMENT','MUTAGENIC_STRENGTH','RED_MASK','WARPED_TONGS','NLOTHS_GIFT','BLOODY_IDOL','GOLDEN_IDOL','MARK_OF_THE_BLOOM','ODD_MUSHROOM'])];
  for(const id of ids)if(!acquisitionScreens.includes(id))await t.test(id,()=>exercise({...base(),relics:[id],elite:true},id));
});
