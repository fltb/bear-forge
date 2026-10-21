import type {CardMetadata,CardVariant} from '../../../../rules/card-instances.types.ts';

export const VolibearCardColor = 6;
export const CardType = {Attack:0,Skill:1,Power:2} as const;
export const CardRarity = {Common:0,Uncommon:1,Rare:2,Basic:3} as const;
type Pair<T> = T | readonly [T,T];
export type VolibearCardCode = `B${string}` | `C${string}` | `U${string}` | `R${string}`;
export type VolibearCardDescription = Readonly<{
  code:VolibearCardCode;
  id:string;
  metadata:CardMetadata;
  text:string;
}>;
const pair = <T>(value:Pair<T>):readonly [T,T] => Array.isArray(value) ? value as unknown as readonly [T,T] : [value as T,value as T];

// IDs and text are catalog data only. Executable effects are bound by definition
// references in the character's card modules, never dispatched by these strings.
function describe(code:VolibearCardCode,name:string,type:number,rarity:number,cost:Pair<number>,damage:Pair<number>,target:boolean,text:string,exhaust:Pair<boolean>=false,strike=false):VolibearCardDescription {
  const costs=pair(cost),damages=pair(damage),exhausts=pair(exhaust);
  const variant=(i:0|1):CardVariant=>({cost:costs[i],damage:damages[i],target,exhaust:exhausts[i],ethereal:false,innate:false,retain:false});
  return {code,id:`VOLIBEAR_${code}`,metadata:{name,type,rarity,color:VolibearCardColor,strike,variants:[variant(0),variant(1)]},text};
}
const {Attack:A,Skill:S,Power:P}=CardType;
const {Basic:B,Common:C,Uncommon:U,Rare:R}=CardRarity;

/** User-approved pool, 2026-10-21. Parentheses denote upgraded values. */
export const volibearCardDescriptions = {
  B01:describe('B01','打击',A,B,1,[6,9],true,'6（9）伤害。',false,true),
  B02:describe('B02','防御',S,B,1,-1,false,'5（8）格挡。'),
  B03:describe('B03','霆爪',A,B,1,[7,9],true,'7（9）伤害，4（6）格挡。'),
  B04:describe('B04','挺身迎战',S,B,1,-1,true,'7（10）格挡，迎战一名敌人。'),
  C01:describe('C01','逼近',A,C,0,[5,8],true,'5（8）伤害。'),
  C02:describe('C02','双爪',A,C,1,[5,7],true,'5（7）伤害，2次。'),
  C03:describe('C03','轰雷重击',A,C,2,[16,21],true,'单体16（21）伤害，全体5（7）雷伤。'),
  C04:describe('C04','先声夺人',A,C,1,[10,14],true,'10（14）伤害，随后可以迎战目标。'),
  C05:describe('C05','雷霆爪击',A,C,1,[7,10],true,'单体7（10）伤害，全体3（4）雷伤。'),
  C06:describe('C06','进逼',A,C,1,[8,11],true,'8（11）伤害。效果开始时目标未行动且意图含攻击，获得6（8）格挡；否则抽1。'),
  C07:describe('C07','追嗅',A,C,1,[8,11],true,'8（11）伤害。检索抽牌堆最靠顶部的1张攻击加入手牌，不打乱其他牌。'),
  C08:describe('C08','撕开伤口',A,C,1,[8,10],true,'8（10）伤害，施加1（2）易伤。'),
  C09:describe('C09','雷霆横扫',A,C,1,[6,8],false,'全体6（8）攻击伤害，再全体3（4）雷伤。'),
  C10:describe('C10','以牙还牙',A,C,2,[6,9],true,'12（16）格挡，迎战目标，再造成6（9）＋该次迎战格挡吸收量的伤害。无实际迎战时吸收量为0。'),
  C11:describe('C11','正面迎敌',S,C,1,-1,true,'9（12）格挡，随后可以迎战一名敌人。'),
  C12:describe('C12','厚重皮毛',S,C,1,-1,false,'8（11）＋正力量数值的格挡；合并后统一处理敏捷、脆弱。'),
  C13:describe('C13','呼吸',S,C,1,-1,false,'抽3（4），弃1。'),
  C14:describe('C14','雷霆护身',S,C,1,-1,false,'8（11）格挡，全体3（4）雷伤。'),
  C15:describe('C15','重整爪牙',S,C,[1,0],-1,false,'回收弃牌堆1张攻击，本回合下次打出减1费。'),
  C16:describe('C16','扯碎束缚',S,C,0,-1,false,'禁止自身效果并消耗至多2张（升级：全部）手牌状态／诅咒，抽1。'),
  C17:describe('C17','蓄力',S,C,0,-1,false,'本回合4（6）力量。'),
  C18:describe('C18','显圣',S,C,2,-1,false,'10（14）格挡，领域至下回合开始、抽牌之前。'),
  C19:describe('C19','追猎准备',S,C,0,-1,false,'选手牌攻击，本回合末保留；其下次打出每段固定攻击伤害＋3（5），覆盖该次重复效果。'),
  C20:describe('C20','乘势追击',A,C,1,[10,14],true,'10（14）伤害，目标本轮已行动则抽1。'),
  C21:describe('C21','稳住阵脚',S,C,1,-1,true,'8（11）格挡，选定敌人本轮已行动则额外4格挡。'),
  C22:describe('C22','雷震',A,C,2,[5,7],false,'全体5（7）攻击伤害＋2（3）雷伤，重复一次。'),
  U01:describe('U01','雷霆铸躯',P,U,[2,1],-1,false,'入场10格挡。每名敌人完整行动结束，恢复该次行动中攻击实际消耗的格挡；不恢复玩家回合反伤。重复部署不重复恢复。'),
  U02:describe('U02','风暴传导',P,U,[2,1],-1,false,'入场全体6雷伤。指定单体攻击每段命中后，将主目标穿过格挡的伤害（含过量）传给其他敌人作为雷伤，不递归传导。'),
  U03:describe('U03','屹立',P,U,[2,1],-1,false,'下回合起，格挡清空改为失去15。重复部署不减少损耗。10点仅为未确认提案。'),
  U04:describe('U04','战痕',P,U,1,-1,false,'入场8（11）格挡。每回合首次迎战实际吸收攻击伤害后，获得2（3）力量；未吸收不消耗机会。'),
  U05:describe('U05','挟山',A,U,[1,0],0,true,'造成当前格挡数值的伤害，不消耗格挡。'),
  U06:describe('U06','暴烈撕咬',A,U,2,[7,9],true,'7（9）伤害，3次。'),
  U07:describe('U07','崩山',A,U,3,[28,36],true,'本回合此前每对目标打出1张指定单体攻击，自身减1费，最低1；外部减费仍可降至0。'),
  U08:describe('U08','紧咬不放',A,U,1,10,true,'每次完整效果实际攻击存活目标后，本牌本战固定伤害＋4（6）；重复效果可以继续成长。'),
  U09:describe('U09','战中整备',S,U,1,-1,false,'8（11）格挡，将弃牌堆1张攻击置于抽牌堆顶。'),
  U10:describe('U10','磨砺爪牙',S,U,1,-1,false,'抽1。选手牌固定伤害攻击，本战每段固定伤害＋3（5）。'),
  U11:describe('U11','暴风再临',S,U,[1,0],-1,false,'本回合下一张指定单体攻击，额外结算一次完整效果，不算重新打出。'),
  U12:describe('U12','原始力量',S,U,1,-1,false,'正力量翻倍。消耗，升级不消耗。',[true,false]),
  U13:describe('U13','力量归身',S,U,1,-1,false,'获得2（3）力量，取消当前已登记的临时力量回收。'),
  U14:describe('U14','迎战准备',S,U,0,-1,false,'5（8）格挡，本回合下一张牌面含迎战的牌减1费，不叠加。放弃可选迎战仍消耗减费。消耗，升级不消耗。',[true,false]),
  U15:describe('U15','暴风换气',S,U,0,-1,false,'消耗另一张手牌，抽2（3）；坏牌先禁止自身效果。没有另一张手牌不能打出。'),
  U16:describe('U16','蓄势待发',S,U,0,-1,false,'下回合额外2能量、抽2（3）。'),
  U17:describe('U17','古老直觉',S,U,1,-1,false,'预见2（3），抽2。预见可任意弃置所看牌，其余保持相对顺序。'),
  U18:describe('U18','只准交锋',S,U,1,-1,true,'展开领域至下回合开始，迎战一名敌人。消耗，升级不消耗。',[true,false]),
  U19:describe('U19','风暴不散',S,U,1,-1,false,'已有领域则延长1（2）个玩家回合；否则开至下个（下下个）玩家回合开始。消耗。',true),
  U20:describe('U20','势不可挡',A,U,1,[10,14],true,'本回合此前已打出至少2张攻击，获得2能量，无额外次数限制。'),
  U21:describe('U21','雷霆余威',P,U,1,-1,false,'每次雷击结算后获得2（3）格挡。'),
  U22:describe('U22','将战斗留下',S,U,[1,0],-1,false,'复制1张手牌攻击加入手牌，继承升级和本战永久成长；不继承一次性加伤、临时减费、单次保留。消耗，复制品不自动消耗。',true),
  U23:describe('U23','迎风咆哮',S,U,1,-1,false,'全体1（2）虚弱，获得7（10）格挡。'),
  U24:describe('U24','饮血而战',A,U,2,[21,28],true,'本次打出直接击杀则恢复4（6）生命，一次主动打出至多治疗一次。消耗。',true),
  U25:describe('U25','猎物未倒',P,U,1,-1,false,'入场抽1。每回合首次对同一敌人打出第2张指定单体攻击后，抽1（2）；由此抽到的攻击本回合下次打出减1费。入场抽牌不带减费。'),
  U26:describe('U26','愈战愈烈',P,U,1,-1,false,'入场1力量。每回合第2张攻击打出后，获得1（2）力量。'),
  U27:describe('U27','淬躯爪击',A,U,1,[8,11],true,'8（11）伤害，6（8）格挡，然后本牌本战基础格挡＋2。'),
  U28:describe('U28','雷霆反扑',S,U,2,-1,true,'12（16）格挡，迎战目标，再全体4（6）＋本次迎战吸收量的雷伤。不计攻击次数。'),
  U29:describe('U29','雷霆渐盛',P,U,1,-1,false,'每次雷伤＋2（3）。'),
  U30:describe('U30','铭记猎物',S,U,1,-1,false,'8（11）格挡，选手牌1（至多2）张攻击，本战获得保留。'),
  U31:describe('U31','万钧连踏',A,U,-1,[5,7],true,'单体5（7）攻击伤害，再全体3雷伤，重复X次。算一次打出；重复效果沿用已支付X，主目标死亡后剩余群雷继续。'),
  R01:describe('R01','唯我之律',P,R,[3,2],-1,false,'领域持续本场战斗。'),
  R02:describe('R02','不动神躯',P,R,[3,2],-1,false,'格挡抵挡攻击时不消耗，超过当前格挡的部分仍扣血。不提供跨回合留挡。'),
  R03:describe('R03','战无止境',P,R,[2,1],-1,false,'入场12格挡。每回合首次迎战实际吸收伤害后，额外获得吸收总量的格挡。完整行动后先铸躯恢复，再获得派生格挡。'),
  R04:describe('R04','雷霆铭身',P,R,[2,1],-1,false,'每回合首张固定伤害攻击结算前，该牌本战每段固定攻击伤害＋6。'),
  R05:describe('R05','全身之力',S,R,[2,1],-1,false,'当前格挡变为3倍；派生部分不重复吃敏捷、脆弱。'),
  R06:describe('R06','天人合一',S,R,2,-1,false,'3（4）力量、10（14）格挡，手牌所有固定伤害攻击本战每段＋3（4）。消耗。',true),
  R07:describe('R07','天崩地裂',S,R,[2,1],-1,false,'全体受到当前格挡数值的雷伤，不消耗格挡。'),
  R08:describe('R08','雷霆万钧',A,R,3,[10,13],true,'单体10（13）伤害4次，再全体5（8）雷伤。主目标死亡后停止单体段，战斗未结束则仍结算群雷。'),
  R09:describe('R09','众敌皆来',S,R,2,-1,false,'20（28）格挡，按左到右依次完整迎战所有未行动敌人，再全体造成迎战吸收总量的雷伤。'),
  R10:describe('R10','这场战斗尚未结束',S,R,1,-1,false,'回收至多3（4）张弃牌攻击，本回合各自下次打出减1费；同类减费不叠加。'),
  R11:describe('R11','古神的技艺',S,R,1,-1,false,'选手牌固定伤害攻击，将本战永久攻击增量翻倍，再令每段固定伤害＋6（10）。不翻倍基础、力量、临时加伤、格挡成长或动态伤害。消耗。',true),
  R12:describe('R12','解放本能',S,R,1,-1,false,'抽至手牌7（9）张。'),
  R13:describe('R13','重返蛮荒',S,R,2,-1,false,'无领域：开至下回合开始并获2（3）力量；已有领域：恢复6（9）生命，不加力量、不续领域。消耗。',true),
  R14:describe('R14','不休之猎',P,R,[2,1],-1,false,'部署后每回合对某敌人每打出1张指定单体攻击，后续对它的固定费用单体攻击减1费，最低0；X费不减，重复不计打出。'),
  R15:describe('R15','风暴即我',P,R,[3,2],-1,false,'攻击与技能中单个敌人的效果扩为全体；保留主目标供费用、条件、追猎、传导。自身收益每完整效果一次，原生群体不复制，原单体身份保留。'),
  R16:describe('R16','愈战神躯',P,R,[2,1],-1,false,'每张攻击完整结算后＋1力量；每张自身牌面实际给予正数格挡的牌完整结算后＋1敏捷，各一次，不计外部响应给挡。'),
} as const satisfies Record<VolibearCardCode,VolibearCardDescription>;
