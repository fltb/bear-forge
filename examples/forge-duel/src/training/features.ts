import type { PolicyRequest } from '@bear-forge/policies';
import type { Features } from '@bear-forge/training';
import { ObservationSchema, ActionSchema, definitions } from '../forge.schemas.ts';
import { cards } from '../index.ts';

const vector=()=>Array<number>(64).fill(0);
function cardFeatures(token:number[],definition:string,offset=16){token[offset+definitions.indexOf(definition as typeof definitions[number])]=1;}
export function encodeForge(request:PolicyRequest):Features {
  const o=ObservationSchema.parse(request.observation), own=o.player, enemy=own==='0'?'1':'0';
  if(request.player!==own||request.options.kind!=='exact')throw Error('Invalid Forge policy request');
  const global=vector();global[1]=1;global[2]=1;global[8]=Number(o.active===own);
  const heroes=([own,enemy] as const).map((seat,i)=>{
    const h=o.heroes[seat],t=vector();t[1]=1;t[3]=1;t[8]=i;
    [h.hp/20,h.mana/6,h.maxMana/6,h.turns/30,h.fatigue/12,h.deckCount/12,h.handCount/8].forEach((x,j)=>t[9+j]=x);
    return t;
  });
  const hand=o.hand.map((c,index)=>{const t=vector();t[1]=1;t[4]=1;t[9]=index/8;cardFeatures(t,c.definition);return t;});
  const boards=([own,enemy] as const).flatMap((seat,i)=>o.heroes[seat].board.map((u,index)=>{
    const t=vector();t[1]=1;t[5]=1;t[8]=i;t[9]=u.attack/10;t[10]=u.hp/10;t[11]=Number(u.ready);t[12]=index/4;cardFeatures(t,u.card.definition);return t;
  }));
  const discards=([own,enemy] as const).map((seat,i)=>{const t=vector();t[1]=1;t[7]=1;t[8]=i;for(const c of o.heroes[seat].discard)t[16+definitions.indexOf(c.definition)]!+=.5;return t;});
  const history=o.history.slice(-32).map(e=>{const t=vector();t[1]=1;t[6]=1;
    t[8+['carry','draw','burn','available','play','attack','damage','heal','death','turn','result'].indexOf(e.kind)]=1;
    t[20]=Number(e.actor===own);t[21]=(e.amount??0)/20;if(e.definition)cardFeatures(t,e.definition,24);return t;
  });
  const actions=request.options.values.map(raw=>{
    const a=ActionSchema.parse(raw),t=vector();t[1]=1;t[8+['play','attack','end'].indexOf(a.kind)]=1;
    if(a.kind==='play'){
      const c=o.hand.find(c=>c.id===a.cardId);if(!c)throw Error('Missing visible card');cardFeatures(t,c.definition);
      t[48]=o.hand.findIndex(c=>c.id===a.cardId)/8;const rule=cards[c.definition];t[25]=rule.cost/6;t[26]=(rule.attack??0)/10;t[27]=(rule.hp??0)/10;
    }
    if(a.kind==='attack'){
      const u=o.heroes[own].board.find(u=>u.id===a.unitId);if(!u)throw Error('Missing visible attacker');
      t[49]=o.heroes[own].board.findIndex(u=>u.id===a.unitId)/4;cardFeatures(t,u.card.definition);t[25]=u.attack/10;t[26]=u.hp/10;
    }
    if('target'in a&&a.target){
      if(a.target==='hero:'+enemy)t[30]=1;
      else if(a.target==='hero:'+own)t[31]=1;
      else{const target=[...o.heroes[own].board,...o.heroes[enemy].board].find(u=>u.id===a.target);
        if(!target)throw Error('Missing visible target');cardFeatures(t,target.card.definition,32);t[41]=target.attack/10;t[42]=target.hp/10;t[43]=Number(target.ready);t[44]=Number(o.heroes[enemy].board.some(u=>u.id===target.id));t[45]=(o.heroes[own].board.findIndex(u=>u.id===target.id)+1)/5;t[46]=(o.heroes[enemy].board.findIndex(u=>u.id===target.id)+1)/5;}
    }
    return t;
  });
  return {tokens:[global,...heroes,...hand,...boards,...discards,...history],actions};
}
