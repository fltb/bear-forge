import {card} from './card.ts';
import {detachRuleValue,readRuleValue} from './rules-values.ts';
import {definitions,handle,statements} from './rules-internal.ts';
import {declareStatic,staticDefinitions} from './rules-module-internal.ts';
import {evaluateQuery} from './rules-queries.ts';
import type {Command,Effect} from './rules.types.ts';
import type {ChoiceAdapter,ChoiceAdapterSpec,ChoiceRequest,ChoiceReply,ChoiceResult,OneChoiceSpec,ManyChoiceSpec,OrderChoiceSpec} from './rules-choices.types.ts';
export type {ChoiceAdapter,ChoiceAdapterSpec,ChoiceRequest,ChoiceReply,ChoiceResult,OneChoiceSpec,ManyChoiceSpec,OrderChoiceSpec} from './rules-choices.types.ts';
export function choicePort<T,P,W,R>(spec:ChoiceAdapterSpec<T,P,W,R>):ChoiceAdapter<T,P,W,R>{
  if(typeof spec.port!=='string'||!spec.port||staticDefinitions.get(spec.request)?.kind!=='query'||typeof spec.reply?.parse!=='function'||typeof spec.decode!=='function')throw Error('Choice adapter requires a port, query, schema and decoder');
  const adapter=handle<ChoiceAdapter<T,P,W,R>>();declareStatic(adapter,{kind:'choice-adapter',port:spec.port,request:spec.request,reply:spec.reply,decode:spec.decode});return adapter;
}
function decodeSelection(request:ChoiceRequest,output:unknown,adapter:Extract<NonNullable<ReturnType<typeof staticDefinitions.get>>,{kind:'choice-adapter'}>):ChoiceReply{
  const parsed=adapter.reply.parse(detachRuleValue(output));const reply=adapter.decode(readRuleValue(request),readRuleValue(parsed));
  if(reply.kind==='skipped'){if(!request.allowSkip)throw Error('Choice cannot be skipped');return{kind:'skipped'};}
  if(request.kind==='one'&&reply.indices.length!==1||reply.indices.length<request.min||reply.indices.length>request.max)throw Error('Choice cardinality is invalid');
  const indices=[...reply.indices];if(new Set(indices).size!==indices.length||indices.some(i=>!Number.isSafeInteger(i)||i<0||i>=request.candidates.length))throw Error('Choice contains an invalid candidate');
  if(request.order==='irrelevant')indices.sort((a,b)=>a-b);
  return{kind:'selected',indices};
}
function choose<T,P,W,R,O>(kind:'one'|'many'|'order',spec:any):Command<O>{
  const effect=handle<Effect<any,O>>();definitions.set(effect,{kind:'compiled',lower(link){
    const adapter=staticDefinitions.get(spec.adapter);
    if(adapter?.kind!=='choice-adapter'||!link.bindings.indices.has(adapter.request))throw Error('Unlinked choice adapter');
    if(!link.ports.has(adapter.port))throw Error('Undeclared choice port');
    link.register(spec.adapter);
    const validate=(locals:Readonly<Record<string,unknown>>,output:unknown)=>{const request=locals.choice as ChoiceRequest;if(!request)throw Error('Missing pending choice');decodeSelection(request,output,adapter);};
    link.guard(effect,{port:adapter.port,validate});
    const result=(request:ChoiceRequest,reply:ChoiceReply):O=>{
      if(kind==='one')return(reply.kind==='skipped'?{kind:'skipped'}:{kind:'selected',value:request.candidates[reply.indices[0]!]})as O;
      if(reply.kind==='skipped')throw Error('Multiple choice cannot be skipped');return reply.indices.map(i=>request.candidates[i])as O;
    };
    return[card.operation(s=>{
      const args=s.input;
      const count=args.candidates.length,min=kind==='one'?(spec.allowSkip?0:1):kind==='order'?count:args.min,max=kind==='one'?1:kind==='order'?count:args.max;
      if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||min<0||max<min)throw Error('Invalid choice bounds');
      const request:ChoiceRequest={kind,player:detachRuleValue(args.player),candidates:detachRuleValue(args.candidates),min,max,order:kind==='order'?'chosen':spec.order??'irrelevant',allowSkip:kind==='one'&&spec.allowSkip};
      s.locals.choice=request;s.locals.automatic=false;
      if(count===0){
        if(kind==='one'&&spec.empty==='request'&&spec.allowSkip){}
        else if(kind==='one'&&spec.empty==='skip'){s.locals.result={kind:'skipped'};s.locals.automatic=true;}
        else if(kind==='many'&&spec.empty==='request'&&min===0){}
        else if(kind!=='one'&&(kind==='order'||spec.empty==='empty')&&min===0){s.locals.result=[];s.locals.automatic=true;}
        else throw Error('Choice has no legal candidates');
      }else if(min>count)throw Error('Choice has no legal candidate subset');
      else if(count===1&&spec.singleton==='automatic'&&min===1&&max>=1){s.locals.result=result(request,{kind:'selected',indices:[0]});s.locals.automatic=true;}
    }),card.branch(s=>s.locals.automatic,[card.return(s=>s.locals.result)]),
    card.operation(s=>evaluateQuery(adapter.request,s.locals.choice,s.state,link.bindings),'publication'),
    card.request(s=>({port:adapter.port,input:s.locals.publication}),'reply'),
    card.return(s=>result(s.locals.choice,decodeSelection(s.locals.choice,s.locals.reply,adapter)))];
  }});
  const node=handle<Command<O>>();statements.set(node,{kind:'call',definition:effect,input:{player:spec.player,candidates:spec.candidates,min:spec.min,max:spec.max}});return node;
}
export function chooseOne<T,P,W,R>(spec:OneChoiceSpec<T,P,W,R>):Command<ChoiceResult<T>>{return choose('one',spec);}
export function chooseMany<T,P,W,R>(spec:ManyChoiceSpec<T,P,W,R>):Command<readonly T[]>{return choose('many',spec);}
export function chooseOrder<T,P,W,R>(spec:OrderChoiceSpec<T,P,W,R>):Command<readonly T[]>{return choose('order',{...spec,candidates:spec.items});}
