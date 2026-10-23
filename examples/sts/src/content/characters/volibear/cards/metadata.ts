import type {CardIdentity} from '../../../../rules/card-instances.types.ts';

export const VolibearCardColor = 6;
export const CardType = {Attack:0,Skill:1,Power:2} as const;
export const CardRarity = {Common:0,Uncommon:1,Rare:2,Basic:3} as const;
type Pair<T> = T | readonly [T,T];
export type VolibearCardCode = `B${string}` | `C${string}` | `U${string}` | `R${string}`;
export type VolibearCardDescription = Readonly<{
  code:VolibearCardCode;
  id:string;
  metadata:CardIdentity;
}>;
const pair = <T>(value:Pair<T>):readonly [T,T] => Array.isArray(value) ? value as unknown as readonly [T,T] : [value as T,value as T];

// Identity and flags are catalog data only. Executable effects are bound by definition
// references in the character's card modules, never dispatched by these strings.
function describe(code:VolibearCardCode,name:string,type:number,rarity:number,cost:Pair<number>,target:boolean,exhaust:Pair<boolean>=false,strike=false):VolibearCardDescription {
  const costs=pair(cost),exhausts=pair(exhaust);
  const variant=(i:0|1):CardIdentity['variants'][0]=>({cost:costs[i],target,exhaust:exhausts[i],ethereal:false,innate:code==='R01'&&i===1,retain:false});
  return {code,id:`VOLIBEAR_${code}`,metadata:{name,type,rarity,color:VolibearCardColor,strike,variants:[variant(0),variant(1)]}};
}
const {Attack:A,Skill:S,Power:P}=CardType;
const {Basic:B,Common:C,Uncommon:U,Rare:R}=CardRarity;

/** User-approved pool, 2026-10-23. Parentheses denote upgraded values. */
export const volibearCardDescriptions = {
  B01:describe('B01','打击',A,B,1,true,false,true),
  B02:describe('B02','防御',S,B,1,false),
  B03:describe('B03','霆爪',A,B,1,true),
  B04:describe('B04','挺身迎战',S,B,1,true),
  C01:describe('C01','逼近',A,C,0,true),
  C02:describe('C02','双爪',A,C,1,true),
  C03:describe('C03','轰雷重击',A,C,2,true),
  C04:describe('C04','先声夺人',A,C,1,true),
  C05:describe('C05','雷霆爪击',A,C,1,true),
  C06:describe('C06','进逼',A,C,1,true),
  C07:describe('C07','追嗅',A,C,1,true),
  C08:describe('C08','撕开伤口',A,C,1,true),
  C09:describe('C09','雷霆横扫',A,C,1,false),
  C10:describe('C10','以牙还牙',A,C,2,true),
  C11:describe('C11','正面迎敌',S,C,1,true),
  C12:describe('C12','厚重皮毛',S,C,1,false),
  C13:describe('C13','呼吸',S,C,1,false),
  C14:describe('C14','雷霆护身',S,C,1,false,[true,false]),
  C15:describe('C15','重整爪牙',S,C,[1,0],false),
  C16:describe('C16','扯碎束缚',S,C,0,false),
  C17:describe('C17','蓄力',S,C,0,false),
  C18:describe('C18','显圣',S,C,2,false),
  C19:describe('C19','追猎准备',S,C,0,false),
  C20:describe('C20','乘势追击',A,C,1,true),
  C21:describe('C21','稳住阵脚',S,C,1,false),
  C22:describe('C22','雷震',A,C,2,false),
  U01:describe('U01','雷霆铸躯',P,U,1,false),
  U02:describe('U02','风暴传导',P,U,1,false),
  U03:describe('U03','屹立',P,U,1,false),
  U04:describe('U04','战痕',P,U,1,false),
  U05:describe('U05','挟山',A,U,[1,0],true),
  U06:describe('U06','暴烈撕咬',A,U,2,true),
  U07:describe('U07','崩山',A,U,3,true),
  U08:describe('U08','紧咬不放',A,U,1,true),
  U09:describe('U09','战中整备',S,U,1,false),
  U10:describe('U10','磨砺爪牙',S,U,1,false),
  U11:describe('U11','暴风再临',S,U,[1,0],false),
  U12:describe('U12','原始力量',S,U,1,false,true),
  U13:describe('U13','力量归身',S,U,1,false),
  U14:describe('U14','迎战准备',S,U,0,false,[true,false]),
  U15:describe('U15','暴风换气',S,U,0,false),
  U16:describe('U16','风暴前夕',S,U,1,false),
  U17:describe('U17','古老直觉',S,U,0,false),
  U18:describe('U18','只准交锋',S,U,1,true,[true,false]),
  U19:describe('U19','风暴不散',S,U,0,false,true),
  U20:describe('U20','势不可挡',A,U,1,true,true),
  U21:describe('U21','雷霆余威',P,U,1,false),
  U22:describe('U22','将战斗留下',S,U,[1,0],false,true),
  U23:describe('U23','迎风咆哮',S,U,1,false),
  U24:describe('U24','饮血而战',A,U,2,true,true),
  U25:describe('U25','猎物未倒',P,U,1,false),
  U26:describe('U26','愈战愈烈',P,U,1,false),
  U27:describe('U27','淬躯爪击',A,U,1,true),
  U28:describe('U28','雷霆反扑',S,U,2,true),
  U29:describe('U29','雷霆渐盛',P,U,1,false),
  U30:describe('U30','铭记猎物',S,U,1,false),
  U31:describe('U31','万钧连踏',A,U,-1,true),
  R01:describe('R01','唯我之律',P,R,2,false),
  R02:describe('R02','不动神躯',P,R,2,false),
  R03:describe('R03','战无止境',P,R,1,false),
  R04:describe('R04','雷霆铭身',P,R,1,false),
  R05:describe('R05','全身之力',S,R,[2,1],false),
  R06:describe('R06','天人合一',S,R,2,false,true),
  R07:describe('R07','天崩地裂',S,R,[2,1],false),
  R08:describe('R08','雷霆万钧',A,R,3,true),
  R09:describe('R09','众敌皆来',S,R,2,false),
  R10:describe('R10','这场战斗尚未结束',S,R,1,false),
  R11:describe('R11','古神的技艺',S,R,1,false,true),
  R12:describe('R12','解放本能',S,R,1,false),
  R13:describe('R13','重返蛮荒',S,R,2,false,true),
  R14:describe('R14','不休之猎',P,R,1,false),
  R15:describe('R15','风暴即我',P,R,2,false),
  R16:describe('R16','愈战神躯',P,R,1,false),
  C23:describe('C23','积云',S,C,1,false),
  C24:describe('C24','霹雳',A,C,1,false),
  C25:describe('C25','雷引',S,C,0,false,true),
  U32:describe('U32','迎雷',P,U,1,false),
  U33:describe('U33','余烬生雷',P,U,1,false),
  U34:describe('U34','雷甲',P,U,1,false),
  U35:describe('U35','雷鸣应战',S,U,1,true),
  U36:describe('U36','奔雷',S,U,0,false,true),
  U37:describe('U37','风暴汇聚',S,U,1,false),
  U38:describe('U38','雷势奔袭',A,U,3,true),
  R17:describe('R17','天雷决',A,R,2,true),
  R18:describe('R18','雷池',S,R,1,false,true),
  R19:describe('R19','不息风暴',P,R,2,false),
  R20:describe('R20','雷贯长空',A,R,2,true),
  R21:describe('R21','雷霆化身',S,R,1,false,true),
  R22:describe('R22','雷痕猎杀',A,R,1,true),
  R23:describe('R23','裂天',A,R,2,true),
  R24:describe('R24','雷涌',S,R,1,false,true),
  R25:describe('R25','风暴重临',S,R,1,false,true),
} as const satisfies Record<VolibearCardCode,VolibearCardDescription>;
