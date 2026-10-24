import {probabilityOperation,probabilityOperationFor} from './probability.ts';
import {attachRuleReplyGuards} from './rules-reply-guards.ts';
import {attachRuleQueries} from './rules-inspection.ts';
import {attachCardAdmission} from './card-admission.ts';
import {admitRuleState} from './rules-state.ts';
import type {ChoiceReplyGuard} from './rules-reply-guards.ts';
import { ruleLayoutIdentity } from './rules-layout.ts';
import { dispatchImmediateEvents } from './rules-reactions.ts';
import type { PortShape, ProgramSchemas } from '@bear-forge/contracts/core';
import { validateQueries,bindQuerySelections } from './rules-queries.ts';
import { bindModules, bindEntityLayouts, createModuleState, staticDefinitions, authorities, definitionOwners, declarationCapture } from './rules-module-internal.ts';
import type { RuleModule } from './rules-module.types.ts';
import { card } from './card.ts';
import type { CardDefinition, CardEffect, CardExpression, CardScope, CardStep } from './card.types.ts';
import type { Effect, Input } from './rules.types.ts';
import { createBuilder } from './rules-builder.ts';
import { definitionCapture, definitions, expressions, statements } from './rules-internal.ts';
import type { AnyEffect, ExpressionContext } from './rules-internal.ts';

/** Typed author trees are lowered once; CardMachine remains the only execution loop. */
export function linkRules<S, Setup, P extends { [K in keyof P]: PortShape }, R>(options: {
  id: string;
  schemas: ProgramSchemas<Setup, P, R>;
  initialize: (setup: Setup) => S;
  entry: Effect<Setup, R>;
  definitions: readonly AnyEffect[];
  modules?: readonly RuleModule<any>[];
  initialEntities?: readonly number[];
}): CardDefinition<S, Setup, P, R> {
  const linkedModules = bindModules(options.modules ?? []);
  const allEffects = [...options.definitions];
  for (const effect of linkedModules.effects) if (!allEffects.includes(effect)) allEffects.push(effect);
  const names = new Map<AnyEffect, string>();
  for (const effect of allEffects) {
    if (!definitions.has(effect)) throw Error('Unbound rule definition');
    if (names.has(effect)) throw Error('Duplicate rule definition');
    names.set(effect, 'r' + names.size);
  }
  if (!names.has(options.entry)) throw Error('Rule entry is not linked');
  const ensure=(effect:AnyEffect):string=>{
    const old=names.get(effect);if(old!==undefined)return old;
    if(!definitions.has(effect))throw Error('Unbound linked rule effect');
    const name='r'+names.size;names.set(effect,name);return name;
  };
  const register=(definition:object):number=>{
    const old=linkedModules.bindings.indices.get(definition);if(old!==undefined)return old;
    if(!staticDefinitions.has(definition))throw Error('Unbound static rule definition');
    const index=linkedModules.bindings.definitions.length;
    (linkedModules.bindings.indices as Map<object,number>).set(definition,index);linkedModules.bindings.definitions.push(definition);return index;
  };
  const registerEntity=(definition:object):number=>{
    const metadata=staticDefinitions.get(definition),kind=metadata?.kind==='entity'&&staticDefinitions.get(metadata.entityKind);
    if(metadata?.kind!=='entity'||!kind||kind.kind!=='entity-kind'||!linkedModules.bindings.indices.has(metadata.entityKind))throw Error('Unlinked entity definition kind');
    for(const component of metadata.privateComponents){
      const data=staticDefinitions.get(component);if(data?.kind!=='component'||definitionOwners.has(component))throw Error('Entity private data requires an unowned content component');register(component);
    }
    const existing=linkedModules.bindings.indices.get(definition);if(existing!==undefined)return existing;
    const index=register(definition),seen=new Set<object>();
    const include=(value:unknown):void=>{
      if(value===null||typeof value!=='object'||seen.has(value))return;seen.add(value);
      const child=staticDefinitions.get(value);
      if(child?.kind==='entity'){registerEntity(value);return;}
      if(child||definitions.has(value))return;
      for(const item of Object.values(value))include(item);
    };
    include(metadata.config);return index;
  };
  const effects: CardEffect<S>[] = [], layoutTrees:unknown[]=[],layoutLocals=new Map<object,string>();
  const replyGuards=new Map<string,ChoiceReplyGuard>();
  let runtimeIdentity='';let runtimeNames:readonly string[]=[];
  const selectorOrder:object[]=[],selectorIndices=new Map<object,number>();
  const lowered=new Set<AnyEffect>(),selectors=new Map<object,{kind:object;select:(config:any)=>AnyEffect}>(),selectedEffects=new Map<object,Map<number,AnyEffect>>();
  const resolveReference=(ref:any,entities:any,allowStatic:boolean,activeSource:number|null=null):string=>{
    if(!ref||ref.program!==runtimeIdentity||!Number.isSafeInteger(ref.effect)||ref.effect<0||!runtimeNames[ref.effect])throw Error('Invalid dynamic rule effect reference');
    if(ref.selector===null&&allowStatic){if(ref.source!==null&&(!Number.isSafeInteger(ref.source)||ref.source<0))throw Error('Invalid static task source');return runtimeNames[ref.effect]!;}
    if(!Number.isSafeInteger(ref.selector)||ref.selector<0||!Number.isSafeInteger(ref.source)||ref.source<0||!entities?.[ref.source]||entities[ref.source].phase==='removing'&&activeSource!==ref.source)throw Error('Invalid dynamic rule effect reference');
    const selector=selectorOrder[ref.selector],selected=selector&&selectedEffects.get(selector)?.get(entities[ref.source].definition);
    if(!selected||names.get(selected)!==runtimeNames[ref.effect])throw Error('Unbound dynamic rule effect');return runtimeNames[ref.effect]!;
  };
  while(true){
  for (const [effect, id] of names) {
    if(lowered.has(effect))continue;lowered.add(effect);
    const definition = definitions.get(effect)!;
    if(definition.kind==='compiled'){effects.push({id,steps:definition.lower({bindings:linkedModules.bindings,names,ensure,register,identity:()=>runtimeIdentity,effectName:index=>runtimeNames[index],resolveReference,ports:new Set(Object.keys(options.schemas.ports)),guard:(effect,guard)=>replyGuards.set(ensure(effect),guard)})});continue;}
    if (definition.kind === 'bound') {
      const run = definition.bind(linkedModules.bindings);
      const operation = (scope:CardScope<S>) => run(scope, scope.input), probability=probabilityOperationFor(run);
      if (probability) probabilityOperation(operation,probability);
      effects.push({ id, steps: [card.operation<S>(operation, 'result'),
        card.invoke<S>(ensure(dispatchImmediateEvents)),
        card.return<S>(scope => scope.locals.result)] });
      continue;
    }
    if (definition.kind === 'port') {
      if (!Object.hasOwn(options.schemas.ports, definition.port)) throw Error('Undeclared rule port');
      effects.push({ id, steps: [card.request<S>(s => ({ port: definition.port, input: s.input }), 'reply'),
        card.return<S>(s => s.locals.reply)] });
      continue;
    }
    const owner = {}, locals = new Map<object, string>();
    const nested:AnyEffect[]=[],nestedStatic:object[]=[],previousCapture=definitionCapture.current,previousDeclarations=declarationCapture.definitions;
    let tree:ReturnType<typeof definition.build>;
    definitionCapture.current=nested;declarationCapture.definitions=nestedStatic;
    try{tree=definition.build(createBuilder(owner,locals));}finally{definitionCapture.current=previousCapture;declarationCapture.definitions=previousDeclarations;}
    for(const child of nested)ensure(child);
    for(const child of nestedStatic)if(staticDefinitions.get(child)?.kind==='query')register(child);
    for(const [value,key]of locals)layoutLocals.set(value,id+'/'+key);
    const layoutNodes:unknown[]=[];layoutTrees.push(layoutNodes);
    const lexicalItems = new Map<object, (context: ExpressionContext) => unknown>();
    const lexicalActive = new Set<object>();
    const contexts=new WeakMap<CardScope<S>,ExpressionContext>();
    const createContext = (scope: CardScope<S>): ExpressionContext => ({
      owner, slots: locals, input: scope.input, locals: scope.locals, lexical: lexicalItems,
      world:scope.state, bindings:linkedModules.bindings,identity:()=>runtimeIdentity,evaluate:value=>evaluate(value,scope),
      entityEffect:(selector,entity)=>{
        const state=(scope.state as any).$rules,record=state?.entities[entity];
        if(!record||record.phase==='removing'&&state.sources.at(-1)!==entity)throw Error('Entity effect source has left');
        const target=selectedEffects.get(selector)?.get(record.definition);
        const name=target&&names.get(target);if(!name)throw Error('Entity effect has no matching typed entry');
        return{program:runtimeIdentity,effect:Number(name.slice(1)),source:entity,selector:selectorIndices.get(selector)!};
      },
    });
    const context=(scope:CardScope<S>):ExpressionContext=>{
      let value=contexts.get(scope);if(!value){value=createContext(scope);contexts.set(scope,value);}return value;
    };
    type Reader=(scope:CardScope<S>)=>unknown;
    type LiteralReader=(scope:CardScope<S>,memo:unknown[]|null)=>unknown;
    const readers=new WeakMap<object,Reader>();
    const bindValue=(root:unknown):Reader=>{
      if(root!==null&&typeof root==='object'){const known=readers.get(root);if(known)return known;}
      const literals=new Map<object,LiteralReader>();let shared=false,slot=0;
      const bind=(value:unknown):LiteralReader=>{
        if(value===null||typeof value!=='object'){
          if(typeof value==='function'||typeof value==='symbol')throw Error('Rule arguments must be data');
          return()=>value;
        }
        const item=lexicalItems.get(value);if(item)return scope=>item(context(scope));
        const bound=expressions.get(value);
        if(bound){
          if(bound.owner!==null&&bound.owner!==owner)throw Error('Foreign rule expression');
          for(const input of bound.inputs)bindValue(input);
          return scope=>bound.read(context(scope));
        }
        if(authorities.has(value))throw Error('Owner authority cannot be runtime data');
        const definition=staticDefinitions.get(value);
        if(definition){
          const index=linkedModules.bindings.indices.get(value);if(index===undefined)throw Error('Unbound static rule definition');
          return definition.kind==='entity'?()=>({program:runtimeIdentity,definition:index}):()=>index;
        }
        if(statements.has(value)||definitions.has(value))throw Error('Static rule handle used as runtime data');
        const previous=literals.get(value);if(previous){shared=true;return previous;}
        const array=Array.isArray(value);
        if(!array&&Object.getPrototypeOf(value)!==Object.prototype)throw Error('Rule literal must be plain data');
        const index=slot++,length=array?value.length:0;
        const fields:{key:string;read:LiteralReader}[]=[];
        const read:LiteralReader=(scope,memo)=>{
          if(memo&&memo[index]!==undefined)return memo[index];
          const output=(array?new Array(length):{}) as Record<string,unknown>;
          if(memo)memo[index]=output;
          for(const field of fields){
            const result=field.read(scope,memo),key=field.key;
            if(key in output)Object.defineProperty(output,key,{value:result,enumerable:true,writable:true,configurable:true});
            else output[key]=result;
          }
          return output;
        };
        literals.set(value,read);
        for(const key of Object.keys(value)){
          const descriptor=Object.getOwnPropertyDescriptor(value,key)!;
          if(!Object.hasOwn(descriptor,'value'))throw Error('Rule literals cannot contain accessors');
          fields.push({key,read:bind(descriptor.value)});
        }
        return read;
      };
      const read=bind(root),result:Reader=scope=>read(scope,shared?[]:null);
      if(root!==null&&typeof root==='object')readers.set(root,result);
      return result;
    };
    const evaluate=(value:unknown,scope:CardScope<S>):any=>{
      if(value===null||typeof value!=='object')return value;
      return bindValue(value)(scope);
    };
    const validateValue = (value: any, active = new Set<object>()): void => {
      if (value === null || typeof value !== 'object') {
        if (typeof value === 'function' || typeof value === 'symbol') throw Error('Rule arguments must be data');
        return;
      }
      if (lexicalItems.has(value)) { if (!lexicalActive.has(value)) throw Error('Escaped rule loop item'); return; }
      const expression = expressions.get(value);
      if (expression) {
        if (expression.owner !== null && expression.owner !== owner) throw Error('Foreign rule expression');
        if(expression.effectSelector&&!selectors.has(value)){selectors.set(value,expression.effectSelector);selectorIndices.set(value,selectorOrder.length);selectorOrder.push(value);}
        for(const reference of expression.references)if(!linkedModules.bindings.indices.has(reference)){
          const metadata=staticDefinitions.get(reference);
          if(metadata?.kind==='entity')registerEntity(reference);
          else if(metadata?.kind==='component'&&!definitionOwners.has(reference))register(reference);
          else if(metadata?.kind==='queue')register(reference);
          else throw Error('Unbound expression definition');
        }
        for(const input of expression.inputs)validateValue(input,active);
        return;
      }
      if(authorities.has(value))throw Error('Owner authority cannot be runtime data');
      if(staticDefinitions.has(value)){if(staticDefinitions.get(value)?.kind==='entity')registerEntity(value);else if(!linkedModules.bindings.indices.has(value))throw Error('Unbound static rule definition');return;}
      if (definitions.has(value) || statements.has(value)) throw Error('Static rule handle used as runtime data');
      if (active.has(value)) throw Error('Cyclic literal rule argument');
      if (Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) throw Error('Rule literal must be plain data');
      active.add(value);
      for (const key of Object.keys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!Object.hasOwn(descriptor, 'value')) throw Error('Rule literals cannot contain accessors');
        validateValue(descriptor.value, active);
      }
      active.delete(value);
    };
    const capture = (value: any, seen = new Map<object, any>()): any => {
      if (value === null || typeof value !== 'object' || expressions.has(value) || lexicalItems.has(value) || staticDefinitions.has(value)) return value;
      if (seen.has(value)) return seen.get(value);
      const out: any = Array.isArray(value) ? new Array(value.length) : {}; seen.set(value,out);
      for (const key of Object.keys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!Object.hasOwn(descriptor, 'value')) throw Error('Rule literals cannot contain accessors');
        Object.defineProperty(out, key, { value: capture(descriptor.value, seen), enumerable: true });
      }
      return Object.freeze(out);
    };
    const expression = (value: any) => {
      validateValue(value); const saved = capture(value);
      return bindValue(saved);
    };
    // Literal lowering preserves the typed scalar/list result. Opaque handles
    // have separate physical representations and do not use this assertion.
    const typedExpression=<T>(value:Input<T>):CardExpression<S,T>=>expression(value) as CardExpression<S,T>;
    let temporary = 0;
    const activeNodes = new Set<object>();
    const compile = (value: object, to: string | null = null): CardStep<S>[] => {
      const node = statements.get(value);
      if (!node || activeNodes.has(value)) throw Error('Invalid or cyclic rule statement');
      activeNodes.add(value);
      layoutNodes.push({...node,slot:node.kind==='assign'?locals.get(node.slot):undefined,steps:node.kind==='sequence'?node.steps.length:undefined,body:undefined,yes:undefined,no:undefined});
      let out: CardStep<S>[];
      switch (node.kind) {
        case 'sequence': out = node.steps.flatMap(item => compile(item)); break;
        case 'when': out = [card.branch<S>(typedExpression<boolean>(node.test), compile(node.yes), compile(node.no))]; break;
        case 'while': out = [card.repeat<S>(typedExpression<boolean>(node.test), compile(node.body))]; break;
        case 'call': {
          if(expressions.has(node.definition)||lexicalItems.has(node.definition)){
            const target=expression(node.definition),input=expression(node.input),slot='t'+temporary++;
            out=[card.operation<S>(s=>{
              const ref=target(s) as {source:number},state=(s.state as any).$rules;
              resolveReference(ref,state?.entities,false,state?.sources.at(-1)??null);
              state.sources.push(ref.source);return ref;
            },slot),card.invoke<S>(s=>'r'+s.locals[slot].effect,input,to),card.operation<S>(s=>{
              if((s.state as any).$rules.sources.pop()!==s.locals[slot].source)throw Error('Invalid entity call source stack');delete s.locals[slot];
            })];
          }else{
            const target=node.definition as AnyEffect;
            const name=names.get(target)??(definitions.get(target)?.kind==='compiled'?ensure(target):undefined);if(name===undefined)throw Error('Unbound rule call; link the effect or its owning module');
            out=[card.invoke<S>(name,expression(node.input),to)];
          }
          break;
        }
        case 'assign': {
          const key = locals.get(node.slot); if (key === undefined) throw Error('Foreign rule local');
          if (node.value && typeof node.value === 'object' && statements.has(node.value)) {
            if (statements.get(node.value)!.kind !== 'call') throw Error('Only a command produces an assignable result');
            out = compile(node.value, key);
          } else out = [card.operation<S>(expression(node.value), key)];
          break;
        }
        case 'return': out = [card.return<S>(expression(node.value))]; break;
        case 'each': {
          const items = 't' + temporary++, index = 't' + temporary++;
          layoutLocals.set(node.item,id+'/item:'+items+':'+index);
          const list = typedExpression<readonly unknown[]>(node.items);
          if (lexicalItems.has(node.item)) throw Error('Rule loop item reused');
          const readItem = (s: ExpressionContext) => {
            if (!Object.hasOwn(s.locals,items) || !Object.hasOwn(s.locals,index)) throw Error('Escaped rule loop item');
            return s.locals[items][s.locals[index]];
          };
          lexicalItems.set(node.item, readItem);
          lexicalActive.add(node.item);
          const body = compile(node.body);
          lexicalActive.delete(node.item);
          out = [card.operation<S>(s => {
            const value = list(s);
            s.locals[items] = [...value]; s.locals[index] = 0;
          }), card.repeat<S>(s => s.locals[index] < s.locals[items].length, [
            ...body, card.operation<S>(s => { s.locals[index]++; }),
          ]), card.operation<S>(s => { delete s.locals[items]; delete s.locals[index]; })];
          break;
        }
      }
      activeNodes.delete(value); return out;
    };
    effects.push({ id, steps: compile(tree) });
  }
  for(const [value,selector]of selectors){
    let table=selectedEffects.get(value);if(!table){table=new Map();selectedEffects.set(value,table);}
    for(const [index,definition]of linkedModules.bindings.definitions.entries()){
      const metadata=staticDefinitions.get(definition);
      if(metadata?.kind!=='entity'||metadata.entityKind!==selector.kind||table.has(index))continue;
      const target=selector.select(metadata.config);
      if(!definitions.has(target))throw Error('Entity selector must return a defined effect');
      table.set(index,target);ensure(target);
    }
  }
  if(lowered.size===names.size)break;
  }
  for(const [selector,table]of selectedEffects)layoutTrees.push(['entity-entry',selector,[...table.entries()]]);
  for(const [definition,index] of linkedModules.bindings.indices){
    const metadata=staticDefinitions.get(definition)!;
    if(metadata.kind!=='ability'||metadata.abilityKind==='modifier')continue;
    const effect=names.get(metadata.effect);if(effect===undefined)throw Error('Unlinked reaction effect');
    linkedModules.bindings.reactions.set(index,{metadata,effect});
  }
  bindQuerySelections(linkedModules.bindings,register);validateQueries(linkedModules.bindings);
  bindEntityLayouts(linkedModules.bindings);
  const initialEntities=Object.freeze([...(options.initialEntities??[])]);
  if(new Set(initialEntities).size!==initialEntities.length||initialEntities.some(entity=>!Number.isSafeInteger(entity)||entity<0||entity>=Number.MAX_SAFE_INTEGER))throw Error('Invalid initial rule entity');
  const initialize = (setup: Setup): S => {
    const world = options.initialize(setup);
    if (options.modules?.length) {
      if (!world || typeof world !== 'object' || Array.isArray(world) || Object.hasOwn(world,'$rules')) throw Error('Rules require an object world without reserved module state');
      Object.defineProperty(world,'$rules',{value:createModuleState(linkedModules.bindings,initialEntities),writable:true,enumerable:true,configurable:true});
    }
    return world;
  };
  runtimeNames=[...names.values()];
  runtimeIdentity=ruleLayoutIdentity(options.id,linkedModules.bindings,names,layoutTrees,layoutLocals);
  linkedModules.bindings.programIdentity=runtimeIdentity;
  attachRuleReplyGuards(effects,replyGuards);
  const result={ id: runtimeIdentity, schemas: options.schemas, initialize,
    entry: names.get(options.entry)!, effects };
  attachRuleQueries(result,linkedModules.bindings);
  if(options.modules?.length)attachCardAdmission(result,state=>admitRuleState(state,linkedModules.bindings,runtimeNames.length,selectorOrder.length));
  return result;
}
