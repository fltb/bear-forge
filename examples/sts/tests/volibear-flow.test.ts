import test from 'node:test';
import assert from 'node:assert/strict';
import {productionDriver} from './production-driver.ts';
import {volibearCardDescriptions} from '../src/content/characters/volibear/cards/metadata.ts';

test('Volibear normal A20 start, rewards and successive combats complete in the controlled executor',()=>{
  const controlled=productionDriver('130','volibear',true);
  const pool=new Set(Object.values(volibearCardDescriptions).map(c=>c.id));
  const combats=new Set<number>();let rewards=0;
  try{
    const initial=controlled.frame();
    assert.equal(initial.game.maxHp,75);assert.equal(initial.game.hp,68);
    assert.equal(initial.game.deck.length,11);
    assert.equal(initial.game.deck.filter(c=>c.id==='VOLIBEAR_B01').length,4);
    assert.equal(initial.game.deck.filter(c=>c.id==='VOLIBEAR_B02').length,4);
    assert.ok(initial.game.relics.some(r=>r.id==='VOLIBEAR_HUNTERS_HEART'));
    for(let decision=0;decision<120;decision++){
      const frame=controlled.frame();
      if(frame.battle){
        if(!combats.has(frame.game.floor)){
          assert.equal(frame.battle.turn,0);assert.equal(frame.battle.player.energy,3);
          assert.equal(frame.battle.hand.length,5);assert.equal(frame.battle.player.strength,0);
          assert.ok(frame.battle.effects?.some(e=>e.name==='雷势'&&e.level===0));
          combats.add(frame.game.floor);
        }
        if(combats.size===3){assert.ok(frame.game.deck.length>=13);break;}
      }
      for(const offer of frame.game.rewards?.cards??[]){
        rewards++;for(const card of offer)assert.ok(pool.has(card.id),card.id);
      }
      assert.ok(frame.actions.length>0);
      const bits=frame.actions[0]!.bits;controlled.advance(bits);
    }
    assert.equal(combats.size,3);assert.ok(rewards>0);
  }finally{controlled.close();}
});
