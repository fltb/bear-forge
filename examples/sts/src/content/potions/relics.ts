import {rules} from '../../rules/execution.ts';
import {adventures} from '../../rules/adventures.ts';
import {resources} from '../../rules/resources.ts';
const {defineRules,defineEffect,when,call,query}=rules;
/** Shared trigger for an actual drink, never for discarding or automatic Fairy revival. */
export const potionRelics=defineRules({requires:[adventures,resources],build(){
  const used=defineEffect<number,void>(b=>when(query(adventures.exports.hasRelic,{run:b.input,id:'TOY_ORNITHOPTER'}),call(resources.exports.heal,{entity:b.read(v=>v.query(adventures.exports.bindings,v.input).actor),amount:5})));
  return{exports:{used}};
}});
