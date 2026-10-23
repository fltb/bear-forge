import {rules} from '../../rules/execution.ts';
import type {AdventureChoiceExports} from '../../rules/adventure-choices.ts';

/** A presentation attached to the actual authored effect, not an opcode or an interpreter. */
export type EventStep = {effect:rules.Effect<number,void>;text:(view:rules.ReadView<number>)=>string};
export type EventOption = EventStep & {id:number;allowed?:(view:rules.ReadView<number>)=>boolean};
export type EventValue = number | ((view:rules.ReadView<number>)=>number);
export const eventValue=(value:EventValue,view:rules.ReadView<number>)=>typeof value==='number'?value:value(view);
export function eventStep(effect:rules.Effect<number,void>,text:string|EventStep['text']):EventStep {
  return {effect,text:typeof text==='string'?()=>text:text};
}
export function eventSequence(...steps:EventStep[]):EventStep {
  return eventStep(rules.defineEffect<number,void>(b=>rules.sequence(...steps.map(step=>rules.call(step.effect,b.input)))),v=>steps.map(step=>step.text(v)).filter(Boolean).join('；'));
}
export function eventOption(id:number,step:EventStep,allowed?:EventOption['allowed']):EventOption {
  return {...step,id,...(allowed===undefined?{}:{allowed})};
}
/** Inline branches retain the enclosing effect's locals and continuation frame. */
export type EventBranch={id:number;text:string|EventStep['text'];execute:rules.Statement;allowed?:EventOption['allowed']};
export function eventBranches(b:rules.Builder<number,void>,ui:rules.RuleModule<AdventureChoiceExports>,options:readonly EventBranch[]):rules.Statement {
  const picked=b.local<number>(),actions=b.local<readonly number[]>(),done=b.local<boolean>();
  return rules.sequence(
    // Preserve the original menu's admission snapshot; only its live descriptions
    // are reprojected after an additional action such as drinking a potion.
    b.assign(actions,b.read(v=>options.filter(o=>!o.allowed||o.allowed(v)).map(o=>o.id))),b.assign(done,false),
    rules.whileDo(b.read(v=>!v.get(done)),rules.sequence(
      b.assign(picked,rules.call(ui.exports.chooseOnce,{run:b.input,actions,
        details:b.read(v=>Object.fromEntries(options.filter(o=>v.get(actions).includes(o.id)).map(o=>[String(o.id),typeof o.text==='string'?o.text:o.text(v)]))),
      })),b.assign(done,b.read(v=>v.get(actions).includes(v.get(picked)))),
    )),
    ...options.map(o=>rules.when(b.read(v=>(v.get(picked)&255)===o.id),o.execute)),
  );
}
/** Both the candidates and their details are projections of these executable choices. */
export function eventMenu(ui:rules.RuleModule<AdventureChoiceExports>,options:readonly EventOption[]) {
  return rules.defineEffect<number,void>(b=>eventBranches(b,ui,options.map(option=>({...option,execute:rules.call(option.effect,b.input)}))));
}
