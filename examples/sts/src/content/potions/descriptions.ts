import {potionPrograms} from './programs.ts';

/** Read-only projection of the executable compositions, never a parallel rule catalog. */
export const potionTexts:Readonly<Record<string,string>>=Object.freeze({
  ...Object.fromEntries(Object.entries(potionPrograms).map(([name,program])=>[name,program.text])),
  EMPTY_POTION_SLOT:'空槽。', INVALID:'无药水。',
  // These identities have no executing implementation for the current characters.
  // Keep the reference information explicit rather than pretend it is an executable rule.
  AMBROSIA:'未装配；参考效果（非本实现规则）：进入神格。',
  BOTTLED_MIRACLE:'未装配；参考效果（非本实现规则）：获得2张奇迹。',
  CUNNING_POTION:'未装配；参考效果（非本实现规则）：获得3张升级小刀。',
  ESSENCE_OF_DARKNESS:'未装配；参考效果（非本实现规则）：空球位填充黑暗球。',
  POISON_POTION:'未装配；参考效果（非本实现规则）：施加6中毒。',
  POTION_OF_CAPACITY:'未装配；参考效果（非本实现规则）：获得2球位。',
  STANCE_POTION:'未装配；参考效果（非本实现规则）：选择愤怒或平静。',
});
