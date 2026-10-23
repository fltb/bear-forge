import {rules} from '../../rules/execution.ts';
import {describeProgram,programText} from '../cards/shared/program-facts.ts';

function orderText(order:Parameters<typeof rules.on<unknown>>[1]['order']):string|undefined{
  if(order===undefined)return '';
  if(typeof order==='number')return `优先级${order}。`;
  const phase='phase' in order?order.phase:order;
  const text=programText(phase)??phase.label;
  return text===undefined?undefined:`${text}${'priority' in order?`，优先级${order.priority??0}`:''}。`;
}

/** The very event, predicate, eligibility and effect passed to on own the projection. */
export function onProgram<T,E={}>(event:rules.RuleEvent<T>,spec:Parameters<typeof rules.on<T,E>>[1]):rules.Ability<E>{
  const eligible=spec.eligible??'registered';
  const ability=rules.on(event,{...spec,eligible});
  const parts=[programText(event),spec.condition?programText(spec.condition):'',programText(spec.effect),orderText(spec.order),typeof eligible==='string'?(eligible==='captured'?'响应捕获后执行。':'响应执行时仍须已注册。'):programText(eligible)];
  describeProgram(ability,parts.every(text=>text!==undefined)?`${parts[0]}时，${spec.condition?'若'+parts[1]+'，':''}${parts[2]}${parts[3]}${parts[4]}`:undefined);
  return ability;
}

/** Replacement checkpoints project the actual filter, effect and eligibility, never an outer macro. */
export function replaceProgram<I,O,E={}>(target:Parameters<typeof rules.replace<I,O,E>>[0],spec:Parameters<typeof rules.replace<I,O,E>>[1]):rules.Ability<E>{
  const eligible=spec.eligible??'registered';
  const ability=rules.replace(target,{...spec,eligible});
  const parts=[programText(target),spec.condition?programText(spec.condition):'',programText(spec.effect),orderText(spec.order),typeof eligible==='string'?(eligible==='captured'?'捕获的替换。':'已注册时替换。'):programText(eligible)];
  describeProgram(ability,parts.every(text=>text!==undefined)?`${parts[0]}：${spec.condition?'若'+parts[1]+'，':''}${parts[2]}${parts[3]}${parts[4]}`:undefined);
  return ability;
}

/** TS transforms remain arbitrary callbacks; only an explicitly described callback projects. */
export function modifyProgram<I,O,E={}>(target:rules.Query<I,O>,spec:Parameters<typeof rules.modify<I,O,E>>[1]):rules.Ability<E>{
  const eligible=spec.eligible??'registered';
  const ability=rules.modify(target,{...spec,eligible});
  const parts=[programText(target),spec.condition?programText(spec.condition):'',programText(spec.transform),orderText(spec.order),typeof eligible==='string'?(eligible==='captured'?'捕获的修正。':'已注册时修正。'):programText(eligible)];
  describeProgram(ability,parts.every(text=>text!==undefined)?`${parts[0]}：${spec.condition?'若'+parts[1]+'，':''}${parts[2]}${parts[3]}${parts[4]}`:undefined);
  return ability;
}
