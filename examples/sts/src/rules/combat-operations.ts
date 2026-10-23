import {z} from 'zod';
import {rules} from './execution.ts';
import {effectPolicy,EffectKind} from './effect-policy.ts';

/** Static semantic declarations, never a second interpreter or Context state. */
export const OperationKind={
  Attack:0,Block:1,Strength:2,Heal:3,Cleanse:4,Revive:5,Deploy:6,
  Escape:7,ApplyPower:8,CreateCard:9,ObtainCard:10,StealGold:11,
  StoreCard:12,Retaliate:13,Contribution:14,Settlement:15,BattleFact:16,EndTurn:17,
} as const;
export type OperationKind=typeof OperationKind[keyof typeof OperationKind];
const qualifications:Readonly<Record<OperationKind,EffectKind|null>>={
  [OperationKind.Attack]:EffectKind.Attack,[OperationKind.Block]:EffectKind.Block,
  [OperationKind.Strength]:EffectKind.Strength,[OperationKind.Heal]:EffectKind.Special,
  [OperationKind.Cleanse]:EffectKind.Special,[OperationKind.Revive]:EffectKind.Special,
  [OperationKind.Deploy]:EffectKind.Special,[OperationKind.Escape]:EffectKind.Special,
  [OperationKind.ApplyPower]:EffectKind.Special,[OperationKind.CreateCard]:EffectKind.Special,
  [OperationKind.ObtainCard]:EffectKind.Special,[OperationKind.StealGold]:EffectKind.Special,
  [OperationKind.StoreCard]:EffectKind.Special,[OperationKind.Retaliate]:EffectKind.Special,
  [OperationKind.Contribution]:EffectKind.Special,[OperationKind.Settlement]:null,
  [OperationKind.BattleFact]:null,[OperationKind.EndTurn]:EffectKind.Special,
};
export const combatOperations=rules.defineRules({requires:[effectPolicy],build(){
  const permitted=rules.defineQuery({
    input:z.object({operation:z.enum(OperationKind),polarity:z.union([z.literal(-1),z.literal(0),z.literal(1)])}),
    output:z.boolean(),dependencies:[effectPolicy.exports.permitted],
    base:(r,i)=>{const effect=qualifications[i.operation];return effect===null||r.query(effectPolicy.exports.permitted,{effect,polarity:i.polarity});},
  });
  return{exports:{permitted}};
}});

/** Operation implementation API. Only trusted semantic implementation modules
 * may import this factory; authored enemy behavior uses the closed operations.
 * Admission precedes every write. This does not promise transaction rollback.
 */
export function defineOperation<I,O=void>(kind:OperationKind,suppressed:O,build:(b:rules.Builder<I,O>)=>rules.Statement):rules.Effect<I,O>{
  const commit=rules.defineEffect<I,O>(build);
  return rules.defineEffect<I,O>(b=>{const result=b.local<O>();return rules.sequence(
    rules.when(b.read(v=>!v.query(combatOperations.exports.permitted,{operation:kind,polarity:1})),b.return(b.read(()=>suppressed))),
    b.assign(result,rules.call(commit,b.input)),b.return(result),
  );});
}
