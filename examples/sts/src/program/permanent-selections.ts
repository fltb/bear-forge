import {rules} from '../rules/execution.ts';
import {describeProgram,programText} from '../rules/program-descriptions.ts';
import {adventures} from "../rules/adventures.ts";
import {cardInstances} from "../rules/card-instances.ts";
import {permanentDecks} from "../rules/permanent-decks.ts";
import {adventureDraws} from "../content/rewards/draws.ts";
import {resources} from "../rules/resources.ts";
import {relics} from "../rules/relics.ts";
import type {AdventureChoiceExports} from "../rules/adventure-choices.ts";
import type {AdventureSelected,AdventureSelection,CardPreview} from "../rules/adventures.types.ts";
const {defineRules,defineEffect,sequence,when,whileDo,forEach,call,query,definitionOf}=rules;
export type SelectionInput={run:number;type:number;count:number;provided:AdventureSelected[]|null;stream:number};
type Selected={run:number;selected:AdventureSelection};
type Picked=Selected&{picked:AdventureSelected};
type Condition<I>={read:(v:rules.ReadView<I>)=>boolean;text?:string};

// Ordinary TS constructors: their children are the actual called effects. A
// missing projection stays missing; no callback is evaluated to infer prose.
export function selectionSequence<I>(...children:rules.Effect<I,void>[]):rules.Effect<I,void>{
  const text=children.map(programText);
  return describeProgram(defineEffect<I,void>(b=>sequence(...children.map(child=>call(child,b.input)))),text.every(t=>t!==undefined)?text.join('；随后'):undefined);
}
export function selectionBranch<I>(condition:Condition<I>,yes:rules.Effect<I,void>,no?:rules.Effect<I,void>):rules.Effect<I,void>{
  const yesText=programText(yes),noText=no===undefined?'不作处理':programText(no);
  return describeProgram(defineEffect<I,void>(b=>when(b.read(condition.read),call(yes,b.input),no===undefined?sequence():call(no,b.input))),condition.text!==undefined&&yesText!==undefined&&noText!==undefined?`若${condition.text}，则${yesText}；否则${noText}`:undefined);
}
export function selectedEach(child:rules.Effect<Picked,void>,reverse=false):rules.Effect<Selected,void>{
  const text=programText(child);
  return describeProgram(defineEffect<Selected,void>(b=>forEach(b.read(v=>reverse?[...v.input.selected.selected].reverse():v.input.selected.selected),picked=>call(child,{run:b.read(v=>v.input.run),selected:b.read(v=>v.input.selected),picked}))),text===undefined?undefined:`按选中顺序${reverse?'逆序':'正序'}逐张执行：${text}`);
}
function selectionResult<I,O>(sample:rules.Effect<I,O>,consume:rules.Effect<{source:I;value:O},void>):rules.Effect<I,void>{
  const first=programText(sample),second=programText(consume);
  return describeProgram(defineEffect<I,void>(b=>{const value=b.local<O>();return sequence(b.assign(value,call(sample,b.input)),call(consume,{source:b.input,value}));}),first!==undefined&&second!==undefined?`${first}；随后${second}`:undefined);
}
export function createPermanentSelections(ui:rules.RuleModule<AdventureChoiceExports>){return defineRules({requires:[ui,adventureDraws],build(){
  const prepare=defineEffect<SelectionInput,void>(b=>{const candidates=b.local<AdventureSelected[]>();return sequence(
    b.assign(candidates,b.read(v=>{if(v.input.provided!==null)return v.input.provided;const run=v.query(adventures.exports.bindings,v.input.run),deck=v.query(permanentDecks.exports.current,run.deck);return deck.cards.flatMap((card,deckIndex)=>{const type=v.input.type,include=type===5||type===3&&v.query(cardInstances.exports.canUpgrade,card)||(type===1||type===4||type===8)&&v.query(cardInstances.exports.canTransform,card)&&!deck.bottles.includes(deckIndex)||type===2&&v.query(cardInstances.exports.canTransform,card);if(!include)return[];const c=v.query(cardInstances.exports.current,card);return[{card:{definition:v.get(definitionOf(cardInstances.exports.kind,card)),upgraded:c.upgraded,misc:c.specialData},deckIndex}];});})),
    call(adventures.exports.beginSelection,{run:b.read(v=>v.input.run),selection:{type:b.read(v=>v.input.type),count:b.read(v=>v.input.count),cards:candidates,selected:[],transformStream:b.read(v=>v.input.type===1?v.input.stream:v.query(adventures.exports.selection,v.input.run).selection.transformStream)}})
  );});
  const mode=(type:number,effect:rules.Effect<Selected,void>)=>Object.freeze({type,effect,text:(count:number|string)=>{const text=programText(effect);if(text===undefined)throw Error('Incomplete permanent selection description');return `选择${count}张牌；${text}`;}});
  const bindings=(v:rules.ReadView<{run:number}>)=>v.query(adventures.exports.bindings,v.input.run);
  function removePicked(clamp:boolean){return describeProgram(defineEffect<Picked,void>(b=>call(permanentDecks.exports.remove,b.read(v=>{
    const deck=bindings(v).deck,cards=v.query(permanentDecks.exports.current,deck).cards,card=cards[clamp?Math.min(v.input.picked.deckIndex,cards.length-1):v.input.picked.deckIndex];
    if(clamp&&card===undefined)throw Error('Source permanent selection requires a remaining card');return{deck,card:card!};
  }))),`从永久牌组移除选中索引当前对应的牌${clamp?'（索引超出牌组时取末张）':''}`);}
  const remove=mode(4,selectedEach(removePicked(true),true));
  const previewCount=1;
  const obtainPreview=describeProgram(defineEffect<{run:number;card:CardPreview},void>(b=>call(permanentDecks.exports.obtain,{deck:b.read(v=>bindings(v).deck),definition:b.read(v=>v.input.card.definition),upgraded:b.read(v=>v.input.card.upgraded),specialData:b.read(v=>v.input.card.misc),count:previewCount,upgrade:false})),`获得${previewCount}张结果牌，保留其升级状态和特殊数据，不再追加升级`);
  function obtainResult<I extends {run:number}>(){return describeProgram(defineEffect<{source:I;value:CardPreview},void>(b=>call(obtainPreview,{run:b.read(v=>v.input.source.run),card:b.read(v=>v.input.value)})),programText(obtainPreview));}
  function transformProgram(type:1|2){
    const upgraded=type===2;
    const sample=describeProgram(defineEffect<Picked,CardPreview>(b=>{const result=b.local<CardPreview>();return sequence(b.assign(result,call(adventureDraws.exports.transformed,{run:b.read(v=>v.input.run),card:b.read(v=>v.input.picked.card),stream:b.read(v=>upgraded?bindings(v).streams.misc:v.input.selected.transformStream),autoUpgrade:upgraded})),b.return(result));}),`以选中牌为来源，使用${upgraded?'misc随机流':'保存的变化随机流'}抽取变化结果${upgraded?'并自动升级':'，不自动升级'}`);
    const reset=describeProgram(defineEffect<Selected,void>(b=>call(adventures.exports.setTransformStream,{run:b.read(v=>v.input.run),stream:b.read(v=>bindings(v).streams.card)})),'将后续变化随机流重置为card随机流');
    return mode(type,selectionSequence(remove.effect,selectedEach(selectionResult(sample,obtainResult<Picked>())),...(!upgraded?[reset]:[])));
  }
  const transform=transformProgram(1),transformUpgraded=transformProgram(2);
  const upgrade=mode(3,selectedEach(describeProgram(defineEffect<Picked,void>(b=>call(permanentDecks.exports.upgrade,b.read(v=>{const deck=bindings(v).deck,card=v.query(permanentDecks.exports.current,deck).cards[v.input.picked.deckIndex];if(card===undefined)throw Error('Upgrade index is no longer valid');return{deck,card};}))),'升级选中索引当前对应的牌')));
  function copies(type:5|6){const text=programText(obtainPreview);return mode(type,selectedEach(describeProgram(defineEffect<Picked,void>(b=>call(obtainPreview,{run:b.read(v=>v.input.run),card:b.read(v=>v.input.picked.card)})),text===undefined?undefined:`以该选中牌为结果来源：${text}`)));}
  const copy=copies(5),obtain=copies(6);
  const bottle=mode(7,describeProgram(defineEffect<Selected,void>(b=>call(permanentDecks.exports.bottle,b.read(v=>{const selected=v.query(adventures.exports.selection,v.input.run).selection.selected[0]!;const type=v.query(cardInstances.exports.definitionMetadata,selected.card.definition).type;if(type<0||type>2)throw Error('Invalid bottled type');return{deck:bindings(v).deck,index:selected.deckIndex,type:type as 0|1|2};}))),'仅将当前选牌记录的第一张选中牌装瓶，使其每场战斗在起始手牌中'));
  const metadata=(v:rules.ReadView<Picked>)=>v.query(cardInstances.exports.definitionMetadata,v.input.picked.card.definition);
  const curse:Condition<Picked>={read:v=>metadata(v).type===3,text:'选中牌为诅咒'};
  const rare:Condition<Picked>={read:v=>metadata(v).rarity===2,text:'选中牌为稀有牌'};
  const nonStarter:Condition<Picked>={read:v=>metadata(v).rarity!==3,text:'选中牌不是初始牌'};
  const uncommon:Condition<Picked>={read:v=>metadata(v).rarity===1,text:'选中牌为罕见牌'};
  function heal(amount:number){return describeProgram(defineEffect<Picked,void>(b=>call(resources.exports.heal,{entity:b.read(v=>bindings(v).actor),amount})),`回复${amount}生命`);}
  function raiseMaxHp(amount:number){return describeProgram(defineEffect<Picked,void>(b=>call(resources.exports.raiseMaxHp,{entity:b.read(v=>bindings(v).actor),amount})),`增加${amount}最大生命`);}
  const fullHeal=describeProgram(defineEffect<Picked,void>(b=>call(resources.exports.heal,{entity:b.read(v=>bindings(v).actor),amount:b.read(v=>v.query(resources.exports.vitality,bindings(v).actor).maxHp)})),'回复至当前最大生命');
  const poopId='SPIRIT_POOP' as const;
  const poop=describeProgram(defineEffect<Picked,void>(b=>call(relics.exports.obtain,{actor:b.read(v=>bindings(v).actor),definition:query(adventures.exports.relic,{run:b.read(v=>v.input.run),id:poopId}),scope:b.read(v=>bindings(v).scope)})),`获得${poopId}`);
  const bonfire=mode(8,selectedEach(selectionSequence(
    selectionBranch(curse,poop,selectionBranch(rare,selectionSequence(raiseMaxHp(10),fullHeal),selectionBranch(nonStarter,selectionBranch(uncommon,heal(10),heal(5))))),
    removePicked(false),
  )));
  const programs=Object.freeze({transform,transformUpgraded,remove,upgrade,copy,obtain,bottle,bonfire});
  const describe=(type:number,count:number|string)=>{const program=Object.values(programs).find(program=>program.type===type);if(!program)throw Error('Unknown permanent selection type');return program.text(count);};
  const finish=defineEffect<{run:number},void>(b=>{const done=b.local<boolean>(),index=b.local<number>(),selected=b.local<AdventureSelection>();return sequence(
    when(b.read(v=>{const s=v.query(adventures.exports.selectionContext,v.input.run);return v.query(resources.exports.vitality,s.actor).hp<=0||s.selection.cards.length===0||s.selection.count<=0;}),b.return(undefined)),b.assign(done,false),
    whileDo(b.read(v=>!v.get(done)),sequence(b.assign(index,call(ui.exports.choose,{run:b.read(v=>v.input.run),actions:b.read(v=>v.query(adventures.exports.selection,v.input.run).selection.cards.map((_,i)=>i))})),b.assign(done,call(adventures.exports.acceptSelection,{run:b.read(v=>v.input.run),index:b.read(v=>v.get(index)&255)})))),b.assign(selected,b.read(v=>v.query(adventures.exports.selection,v.input.run).selection)),
    when(b.read(v=>v.get(selected).type===transform.type),sequence(call(transform.effect,{run:b.read(v=>v.input.run),selected}),b.return(undefined))),
    when(b.read(v=>v.get(selected).type===transformUpgraded.type),sequence(call(transformUpgraded.effect,{run:b.read(v=>v.input.run),selected}),b.return(undefined))),
    when(b.read(v=>v.get(selected).type===remove.type),sequence(call(remove.effect,{run:b.read(v=>v.input.run),selected}),b.return(undefined))),
    when(b.read(v=>v.get(selected).type===upgrade.type),sequence(call(upgrade.effect,{run:b.read(v=>v.input.run),selected}),b.return(undefined))),
    when(b.read(v=>v.get(selected).type===copy.type),sequence(call(copy.effect,{run:b.read(v=>v.input.run),selected}),b.return(undefined))),
    when(b.read(v=>v.get(selected).type===obtain.type),sequence(call(obtain.effect,{run:b.read(v=>v.input.run),selected}),b.return(undefined))),
    when(b.read(v=>v.get(selected).type===bottle.type),sequence(call(bottle.effect,{run:b.read(v=>v.input.run),selected}),b.return(undefined))),
    when(b.read(v=>v.get(selected).type===bonfire.type),sequence(call(bonfire.effect,{run:b.read(v=>v.input.run),selected}),b.return(undefined))),
    b.return(b.read(()=>{throw Error('Permanent selection effect is not implemented');})),
  );});

  const select=defineEffect<SelectionInput,void>(b=>sequence(call(prepare,b.input),call(finish,{run:b.read(v=>v.input.run)})));
  return{exports:{prepare,finish,select,programs,describe}};
}});}
