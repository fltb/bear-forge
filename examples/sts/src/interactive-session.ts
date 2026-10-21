import {validatePresentationCatalog} from './presentation.ts';
import {createCardLoader} from '@bear-forge/runtime-card';
import {createGameBinder} from '@bear-forge/game-host';
import {cardDefinition} from './card.ts';
import {contract} from './contract.ts';
import type {InteractiveOptions,InteractiveStatus,InteractiveCommand} from './interactive-session.types.ts';
import type {Action} from './game.schemas.ts';
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
export async function createInteractiveSession(options:InteractiveOptions){
  validatePresentationCatalog();
  const loaded=unwrap(await createCardLoader({controlled:false,stepBudget:100_000_000}).load(cardDefinition));
  const instance=unwrap(await loaded.core.start({character:options.character,seed:options.seed,detailedEvents:true}));
  const binding=await createGameBinder().bind({instance,contract,...(loaded.persistence?{persistence:loaded.persistence}:{})});
  if(!binding.ok){await instance.close();await loaded.capture?.release(instance.id);throw Error(JSON.stringify(binding.error));}
  const game=binding.value;
  let pending:Action|null=null,decision=0,closed=false;
  const bindPlayer=async()=>unwrap(await game.bind({player:'0',onRequest:async()=>{if(pending===null)return {kind:'pause'};const value=pending;pending=null;return {kind:'reply',value};},onEvent:async packet=>{await options.onEvent(packet.event);return {kind:'reply',value:null};}}));
  async function observe():Promise<InteractiveStatus>{
    if(closed)throw Error('Session closed');
    const state=unwrap(await game.inspect());
    if(state.kind==='fault')throw Error(JSON.stringify(state.error));
    if(state.kind==='ended')return {kind:'ended',result:state.result,observation:unwrap(await game.observe({player:'0'}))};
    if(state.kind!=='request')throw Error('Expected decision boundary');
    const request=state.requests[0];if(!request)throw Error('Missing request');
    const actions=unwrap(await game.describe({requestId:request.id,type:'action'}));
    if(actions.kind!=='exact')throw Error('Expected exact actions');
    return {kind:'decision',record:{sessionId:options.sessionId,decision,observation:request.observation,actions:actions.values}};
  }
  async function act(command:Extract<InteractiveCommand,{op:'act'}>){
    const state=await observe();
    if(state.kind!=='decision')return {accepted:false as const,reason:'Session ended'};
    if(command.sessionId!==options.sessionId||command.decision!==decision)return {accepted:false as const,reason:'Stale or foreign decision'};
    if(command.reason!==undefined&&typeof command.reason!=='string')return {accepted:false as const,reason:'Reason must be text'};
    if(options.review&&(typeof command.reason!=='string'||!command.reason.trim()))return {accepted:false as const,reason:'Review mode requires a nonempty reason'};
    if(!Number.isInteger(command.action)||command.action<0||command.action>=state.record.actions.length)return {accepted:false as const,reason:'Illegal action index'};
    pending=state.record.actions[command.action]!;const advanced=unwrap(await game.run());
    if(!advanced.accepted)throw Error('Legal explicit action was not accepted');
    decision++;return {accepted:true as const,status:await observe()};
  }
  async function close(){if(closed)return;closed=true;await game.close();await loaded.capture?.release(instance.id);}
  try{await bindPlayer();unwrap(await game.run());return {observe,act,close};}catch(error){await close();throw error;}
}
