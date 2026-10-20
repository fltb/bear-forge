// Test-only adapter. Game transitions are executed by the pinned upstream source.
#include <nlohmann/json.hpp>
#include <algorithm>
#include <iostream>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <unordered_set>
#include <numeric>
#include "game/GameContext.h"
#include "combat/BattleContext.h"
#include "sim/search/Action.h"
#include "sim/search/GameAction.h"
#include "sim/search/BattleScumSearcher2.h"
#include "sim/search/ExpertKnowledge.h"
#include "sim/PrintHelpers.h"

using namespace sts;
using J = nlohmann::json;

static J rng(const Random &r) {
    return {{"seed0", std::to_string(r.seed0)}, {"seed1", std::to_string(r.seed1)}, {"counter", r.counter}};
}
static J card(const Card &c) {
    return {{"id", getCardEnumName(c.id)}, {"misc", c.misc}, {"upgraded", c.upgraded}};
}
static J card(const CardInstance &c) {
    return {{"id", getCardEnumName(c.id)}, {"uniqueId", c.uniqueId}, {"specialData", c.specialData},
        {"cost", c.cost}, {"costForTurn", c.costForTurn}, {"upgraded", c.upgraded},
        {"freeToPlayOnce", c.freeToPlayOnce}, {"retain", c.retain}};
}
static J cardPlay(const CardQueueItem &x) {
    return {{"card",card(x.card)},{"target",x.target},{"isEndTurn",x.isEndTurn},{"triggerOnUse",x.triggerOnUse},
        {"ignoreEnergyTotal",x.ignoreEnergyTotal},{"energyOnUse",x.energyOnUse},{"freeToPlay",x.freeToPlay},
        {"randomTarget",x.randomTarget},{"autoplay",x.autoplay},{"regretCardCount",x.regretCardCount},
        {"purgeOnUse",x.purgeOnUse},{"exhaustOnUse",x.exhaustOnUse}};
}
template <class Range> static J cardList(const Range &xs) {
    J out = J::array(); for (const auto &x : xs) out.push_back(card(x)); return out;
}
template <class Range> static J enums(const Range &xs) {
    J out = J::array(); for (auto x : xs) out.push_back(static_cast<int>(x)); return out;
}
static J mapState(const Map &m) {
    J nodes = J::array();
    for (const auto &row : m.nodes) for (const auto &n : row) {
        nodes.push_back({{"x", n.x}, {"y", n.y}, {"room", roomStrings[static_cast<int>(n.room)]},
            {"edges", std::vector<int>(n.edges.begin(), n.edges.begin()+n.edgeCount)},
            {"parents", std::vector<int>(n.parents.begin(), n.parents.begin()+n.parentCount)}});
    }
    return {{"nodes", nodes}, {"burningEliteX", m.burningEliteX}, {"burningEliteY", m.burningEliteY},
        {"burningEliteBuff", m.burningEliteBuff}};
}
static J rewards(const Rewards &r) {
    J cards = J::array(); for (int i=0; i<r.cardRewardCount; ++i) cards.push_back(cardList(r.cardRewards[i]));
    return {{"gold", std::vector<int>(r.gold.begin(), r.gold.begin()+r.goldRewardCount)},
        {"cards", cards}, {"relics", enums(std::vector<RelicId>(r.relics.begin(), r.relics.begin()+r.relicCount))},
        {"potions", enums(std::vector<Potion>(r.potions.begin(), r.potions.begin()+r.potionCount))},
        {"emeraldKey", r.emeraldKey}, {"sapphireKey", r.sapphireKey}};
}
static const char *screenName(ScreenState s) {
    static const char *names[]={"INVALID","EVENT_SCREEN","REWARDS","BOSS_RELIC_REWARDS","CARD_SELECT",
        "MAP_SCREEN","TREASURE_ROOM","REST_ROOM","SHOP_ROOM","BATTLE"};
    return names[static_cast<int>(s)];
}
static J gameState(const GameContext &g) {
    J relics=J::array(); for (const auto &r : g.relics.relics) relics.push_back({{"id", relicEnumNames[static_cast<int>(r.id)]}, {"data", r.data}});
    J r={{"ai",rng(g.aiRng)}, {"cardRandom",rng(g.cardRandomRng)}, {"card",rng(g.cardRng)},
        {"event",rng(g.eventRng)}, {"mathUtil",rng(g.mathUtilRng)}, {"merchant",rng(g.merchantRng)},
        {"misc",rng(g.miscRng)}, {"monsterHp",rng(g.monsterHpRng)}, {"monster",rng(g.monsterRng)},
        {"neow",rng(g.neowRng)}, {"potion",rng(g.potionRng)}, {"relic",rng(g.relicRng)},
        {"shuffle",rng(g.shuffleRng)}, {"treasure",rng(g.treasureRng)}};
    J result={{"seed", std::to_string(g.seed)}, {"ascension",g.ascension}, {"act",g.act}, {"floor",g.floorNum},
        {"screen",screenName(g.screenState)}, {"outcome",static_cast<int>(g.outcome)},
        {"room",roomStrings[static_cast<int>(g.curRoom)]}, {"event",static_cast<int>(g.curEvent)},
        {"eventName",eventGameNames[static_cast<int>(g.curEvent)]},
        {"boss",static_cast<int>(g.boss)}, {"secondBoss",static_cast<int>(g.secondBoss)},
        {"x",g.curMapNodeX}, {"y",g.curMapNodeY}, {"hp",g.curHp}, {"maxHp",g.maxHp}, {"gold",g.gold},
        {"keys",{{"red",g.redKey},{"green",g.greenKey},{"blue",g.blueKey}}}, {"relics",relics},
        {"potions",enums(std::vector<Potion>(g.potions.begin(),g.potions.begin()+g.potionCapacity))},
        {"deck",cardList(g.deck.cards)}, {"bottles",g.deck.bottleIdxs}, {"rng",r}, {"map",mapState(*g.map)},
        {"monsterList",enums(g.monsterList)}, {"monsterOffset",g.monsterListOffset},
        {"eliteList",enums(g.eliteMonsterList)}, {"eliteOffset",g.eliteMonsterListOffset},
        {"cardRarityFactor",g.cardRarityFactor}, {"potionChance",g.potionChance},
        {"monsterChance",g.monsterChance}, {"shopChance",g.shopChance}, {"treasureChance",g.treasureChance},
        {"shopRemoveCount",g.shopRemoveCount}, {"hasContinuation",static_cast<bool>(g.regainControlAction)},
        {"lastRoom",roomStrings[static_cast<int>(g.lastRoom)]},{"speedrunPace",g.speedrunPace},
        {"skipBattles",g.skipBattles},{"potionCount",g.potionCount},{"potionCapacity",g.potionCapacity},
        {"allPotions",enums(g.potions)},{"noteForYourself",card(g.noteForYourselfCard)},
        {"deckCounts",g.deck.cardTypeCounts},{"upgradeableCount",g.deck.upgradeableCount},
        {"transformableCount",g.deck.transformableCount},
        {"relicBits",{std::to_string(g.relics.relicBits0),std::to_string(g.relics.relicBits1),std::to_string(g.relics.relicBits2)}},
        {"eventList",enums(g.eventList)},{"shrineList",enums(g.shrineList)},
        {"oneTimeEvents",enums(g.specialOneTimeEventList)},
        {"relicPools",{{"common",enums(g.commonRelicPool)},{"uncommon",enums(g.uncommonRelicPool)},
            {"rare",enums(g.rareRelicPool)},{"shop",enums(g.shopRelicPool)},{"boss",enums(g.bossRelicPool)}}},
        {"colorlessPool",enums(g.colorlessCardPool)}};
    if (g.screenState==ScreenState::EVENT_SCREEN && g.curEvent==Event::NEOW) {
        J opts=J::array(); for (auto o:g.info.neowRewards) opts.push_back({{"bonus",static_cast<int>(o.r)},
            {"description",Neow::bonusStrings[static_cast<int>(o.r)]},{"drawback",static_cast<int>(o.d)}});
        result["neow"]=opts;
    }
    if (g.screenState==ScreenState::EVENT_SCREEN) result["eventData"]=g.info.eventData;
    if (g.screenState==ScreenState::REWARDS) result["rewards"]=rewards(g.info.rewardsContainer);
    if (g.screenState==ScreenState::BOSS_RELIC_REWARDS) result["bossRelics"]=enums(g.info.bossRelics);
    if (g.screenState==ScreenState::TREASURE_ROOM) result["chestSize"]=static_cast<int>(g.info.chestSize);
    if (g.screenState==ScreenState::CARD_SELECT) {
        J opts=J::array(); for (const auto &x:g.info.toSelectCards) opts.push_back({{"card",card(x.card)},{"deckIndex",x.deckIdx}});
        J selected=J::array();for(const auto &x:g.info.haveSelectedCards)selected.push_back({{"card",card(x.card)},{"deckIndex",x.deckIdx}});
        result["select"]={{"type",static_cast<int>(g.info.selectScreenType)},{"remaining",g.info.toSelectCount},{"cards",opts},
            {"selected",selected},{"transformRng",static_cast<int>(g.info.transformRng)}};
    }
    if (g.screenState==ScreenState::SHOP_ROOM) {
        const auto &s=g.info.shop;
        result["shop"]={{"prices",s.prices},{"removeCost",s.removeCost},{"cards",cardList(s.cards)},
            {"relics",enums(s.relics)},{"potions",enums(s.potions)}};
    }
    return result;
}
static J battleState(const BattleContext &b) {
    J monsters=J::array();
    for (int i=0;i<b.monsters.monsterCount;++i) {
        const auto &m=b.monsters.arr[i]; const auto d=m.getMoveBaseDamage(b);
        monsters.push_back({{"index",m.idx},{"id",static_cast<int>(m.id)},{"name",m.getName()},
            {"hp",m.curHp},{"maxHp",m.maxHp},{"block",m.block},{"moves",enums(m.moveHistory)},
            {"damage",d.damage},{"hits",d.attackCount},{"miscInfo",m.miscInfo},
            {"statusBits",std::to_string(m.statusBits)},{"strength",m.strength},{"weak",m.weak},
            {"vulnerable",m.vulnerable},{"artifact",m.artifact},{"poison",m.poison},
            {"uniquePower0",m.uniquePower0},{"uniquePower1",m.uniquePower1},
            {"halfDead",m.halfDead},{"escaping",m.isEscapingB},{"escapeNext",m.escapeNext}});
    }
    const auto &p=b.player;
    J status=J::array(); for (const auto &x:p.statusMap) status.push_back({static_cast<int>(x.first), x.second});
    J hand=J::array(); for (int i=0;i<b.cards.cardsInHand;++i) hand.push_back(card(b.cards.hand[i]));
    J out={{"encounter",static_cast<int>(b.encounter)}, {"turn",b.turn}, {"input",static_cast<int>(b.inputState)},
        {"seed",std::to_string(b.seed)},{"floor",b.floorNum},{"ascension",b.ascension},
        {"endTurnQueued",b.endTurnQueued},{"turnHasEnded",b.turnHasEnded},{"skipMonsterTurn",b.skipMonsterTurn},
        {"outcome",static_cast<int>(b.outcome)}, {"monsterTurnIndex",b.monsterTurnIdx},
        {"player",{{"hp",p.curHp},{"maxHp",p.maxHp},{"energy",p.energy},{"energyPerTurn",p.energyPerTurn},
            {"block",p.block},{"strength",p.strength},{"dexterity",p.dexterity},{"artifact",p.artifact},
            {"statusBits0",std::to_string(p.statusBits0)},{"statusBits1",p.statusBits1},{"statuses",status},
            {"justApplied",p.justAppliedBits},{"cardsPlayed",p.cardsPlayedThisTurn},{"attacksPlayed",p.attacksPlayedThisTurn},
            {"skillsPlayed",p.skillsPlayedThisTurn},{"gold",p.gold},{"focus",p.focus},{"cardDrawPerTurn",p.cardDrawPerTurn},
            {"cardsDiscarded",p.cardsDiscardedThisTurn},{"lastTargetedMonster",p.lastTargetedMonster},
            {"lastAttackUnblockedDamage",p.lastAttackUnblockedDamage},{"timesDamaged",p.timesDamagedThisCombat}}}, {"monsters",monsters},
        {"cards",{{"hand",hand},{"draw",cardList(b.cards.drawPile)},{"discard",cardList(b.cards.discardPile)},
            {"exhaust",cardList(b.cards.exhaustPile)},{"stasis",cardList(b.cards.stasisCards)},
            {"nextUniqueId",b.cards.nextUniqueCardId},{"counters",{{"handNormalityCount",b.cards.handNormalityCount},{"handPainCount",b.cards.handPainCount},{"strikeCount",b.cards.strikeCount},{"handBloodCardCount",b.cards.handBloodCardCount},{"drawPileBloodCardCount",b.cards.drawPileBloodCardCount},{"discardPileBloodCardCount",b.cards.discardPileBloodCardCount}}}}},
        {"actionQueueSize",b.actionQueue.size},{"cardQueueSize",b.cardQueue.size},
        {"rng",{{"ai",rng(b.aiRng)},{"cardRandom",rng(b.cardRandomRng)},{"misc",rng(b.miscRng)},
            {"monsterHp",rng(b.monsterHpRng)},{"potion",rng(b.potionRng)},{"shuffle",rng(b.shuffleRng)}}},
        {"potions",enums(std::vector<Potion>(b.potions.begin(),b.potions.begin()+b.potionCapacity))},
        {"allPotions",enums(b.potions)},{"potionCount",b.potionCount},{"potionCapacity",b.potionCapacity},
        {"current",cardPlay(b.curCardQueueItem)}};
    out["future"]={{"haveUsedDiscoveryAction",b.haveUsedDiscoveryAction},{"undefinedBehaviorEvoked",b.undefinedBehaviorEvoked},
        {"player",{{"happyFlowerCounter",p.happyFlowerCounter},{"incenseBurnerCounter",p.incenseBurnerCounter},{"inkBottleCounter",p.inkBottleCounter},
        {"inserterCounter",p.inserterCounter},{"nunchakuCounter",p.nunchakuCounter},{"penNibCounter",p.penNibCounter},{"sundialCounter",p.sundialCounter},
        {"haveUsedNecronomiconThisTurn",p.haveUsedNecronomiconThisTurn},{"orangePelletsCardTypesPlayed",p.orangePelletsCardTypesPlayed.to_ulong()},
        {"combustHpLoss",p.combustHpLoss},{"devaFormEnergyPerTurn",p.devaFormEnergyPerTurn},{"echoFormCardsDoubled",p.echoFormCardsDoubled},
        {"panacheCounter",p.panacheCounter},{"bombs",{p.bomb1,p.bomb2,p.bomb3}}}}};
    if (b.inputState==InputState::CARD_SELECT) out["select"]={{"task",cardSelectTaskStrings[static_cast<int>(b.cardSelectInfo.cardSelectTask)]},
        {"pickCount",b.cardSelectInfo.pickCount},{"canPickZero",b.cardSelectInfo.canPickZero},{"canPickAnyNumber",b.cardSelectInfo.canPickAnyNumber}};
    return out;
}

static std::vector<search::Action> legalBattleActions(const BattleContext &b) {
    std::vector<search::Action> out;
    auto add=[&](search::Action a){if(a.isValidAction(b))out.push_back(a);};
    if(b.inputState==InputState::CARD_SELECT) {
        if(b.cardSelectInfo.cardSelectTask==CardSelectTask::EXHAUST_MANY || b.cardSelectInfo.cardSelectTask==CardSelectTask::GAMBLE) {
            for(int mask=0;mask<(1<<b.cards.cardsInHand);++mask)add(search::Action(search::ActionType::MULTI_CARD_SELECT,mask));
        } else for(const auto &a:search::Action::enumerateCardSelectActions(b))add(a);
    } else if(b.inputState==InputState::PLAYER_NORMAL) {
        for(int i=0;i<b.cards.cardsInHand;++i)for(int t=0;t<(b.cards.hand[i].requiresTarget()?b.monsters.monsterCount:1);++t)
            add(search::Action(search::ActionType::CARD,i,t));
        for(int i=0;i<b.potionCapacity;++i) {
            for(int t=0;t<(potionRequiresTarget(b.potions[i])?b.monsters.monsterCount:1);++t)add(search::Action(search::ActionType::POTION,i,t));
            add(search::Action(search::ActionType::POTION,i,6));
        }
        add(search::Action(search::ActionType::END_TURN));
    }
    return out;
}

// Bounded test-only planning over upstream copies. A returned win must replay on the live oracle.
static J beamSearch(const BattleContext &initial,int width,int depthLimit) {
    struct Node { BattleContext state; std::vector<std::uint32_t> path; double score; };
    int initialHp=0;for(int i=0;i<initial.monsters.monsterCount;++i)initialHp+=initial.monsters.arr[i].curHp;
    auto evaluate=[&](const BattleContext &b) {
        if(b.outcome==Outcome::PLAYER_LOSS)return -1e12;
        if(b.outcome==Outcome::PLAYER_VICTORY)return 1e12+b.player.curHp;
        int hp=0,incoming=0;
        for(int i=0;i<b.monsters.monsterCount;++i) {
            const auto &m=b.monsters.arr[i];hp+=m.curHp;
            if(m.isAlive()){const auto d=m.getMoveBaseDamage(b);incoming+=m.calculateDamageToPlayer(b,d.damage)*d.attackCount;}
        }
        const auto &p=b.player;
        double score=(initialHp-hp)*5+p.curHp*14+std::min(p.block,incoming+10)*8;
        score+=p.strength*35+p.dexterity*30;
        score+=p.getStatusRuntime(PS::DEMON_FORM)*140+p.getStatusRuntime(PS::FEEL_NO_PAIN)*60+p.getStatusRuntime(PS::DARK_EMBRACE)*180;
        score+=p.hasStatusRuntime(PS::CORRUPTION)?400:0;
        score+=p.hasStatusRuntime(PS::BARRICADE)?200:0;
        score+=p.energy*3+b.cards.cardsInHand*2-b.turn*30;
        return score;
    };
    std::vector<Node> frontier{{initial,{},evaluate(initial)}};
    std::uint64_t expanded=0;
    for(int depth=0;depth<depthLimit && !frontier.empty();++depth) {
        std::vector<Node> next;std::unordered_set<std::string> seen;
        auto trim=[&](){std::stable_sort(next.begin(),next.end(),[](const auto &a,const auto &b){return a.score>b.score;});if(next.size()>static_cast<std::size_t>(width))next.resize(width);};
        for(const auto &node:frontier)for(const auto &a:legalBattleActions(node.state)) {
            if(a.getActionType()==search::ActionType::POTION && a.getTargetIdx()>5)continue;
            Node child{node.state,node.path,0};child.path.push_back(a.bits);a.execute(child.state);++expanded;
            if(child.state.outcome==Outcome::PLAYER_VICTORY)
                return {{"outcomeHp",child.state.player.curHp},{"solution",child.path},{"expanded",expanded},{"depth",depth+1}};
            if(child.state.outcome==Outcome::PLAYER_LOSS)continue;
            const auto key=battleState(child.state).dump();
            if(!seen.insert(key).second)continue;
            child.score=evaluate(child.state);next.push_back(std::move(child));
            if(next.size()>static_cast<std::size_t>(width*4))trim();
        }
        trim();frontier=std::move(next);
    }
    return {{"outcomeHp",0},{"solution",J::array()},{"expanded",expanded}};
}

template <PS status> static void playerPowerStep(Player &p,const J &s) {
    const auto op=s.at("kind").get<std::string>();const int amount=s.value("amount",0);const bool source=s.contains("source")&&!s.at("source").is_null()&&s.at("source").get<int>()==1;
    if(op=="buff")p.buff<status>(amount);
    else if(op=="debuff")p.debuff<status>(amount,source);
    else if(op=="decrement")p.decrementStatus<status>(amount);
    else if(op=="remove")p.removeStatus<status>();
    else if(op=="clear") {if constexpr(status==PS::WEAK||status==PS::VULNERABLE||status==PS::FRAIL)p.setJustApplied<status>(false);else throw std::runtime_error("Unsupported justApplied fixture");}
    else throw std::runtime_error("Unknown power operation");
}
template <MS status> static void enemyPowerStep(BattleContext &b,const J &s) {
    auto &m=b.monsters.arr[0];const auto op=s.at("kind").get<std::string>();const int amount=s.value("amount",0);const bool source=s.contains("source")&&!s.at("source").is_null()&&s.at("source").get<int>()==1;
    if(op=="buff")m.buff<status>(amount);
    else if(op=="debuff")b.debuffEnemy<status>(0,amount,source);
    else if(op=="decrement")m.decrementStatus<status>(amount);
    else if(op=="remove") {if constexpr(status!=MS::STRENGTH)m.removeStatus<status>();}
    else if(op=="clear") {if constexpr(status==MS::WEAK||status==MS::VULNERABLE)m.setJustApplied<status>(false);else throw std::runtime_error("Unsupported justApplied fixture");}
    else throw std::runtime_error("Unknown power operation");
}

class Reference {
    std::unique_ptr<GameContext> game;
    std::unique_ptr<BattleContext> battle;
    bool heart=false;
    J history=J::array();
    void settle() {
        for (;;) {
            if (game->outcome!=GameOutcome::UNDECIDED) return;
            if (game->screenState!=ScreenState::BATTLE) return;
            if (!battle) { battle=std::make_unique<BattleContext>(); battle->init(*game); }
            if (battle->outcome==Outcome::UNDECIDED) return;
            heart=heart || (battle->encounter==MonsterEncounter::THE_HEART && battle->outcome==Outcome::PLAYER_VICTORY);
            battle->exitBattle(*game); battle.reset();
        }
    }
    std::vector<search::Action> battleActions() const {
        return legalBattleActions(*battle);
    }
    std::vector<search::GameAction> gameActions() const {
        auto out=search::GameAction::getAllActionsInState(*game);
        auto add=[&](search::GameAction a){
            if(a.isValidAction(*game) && std::none_of(out.begin(),out.end(),[&](const auto &x){return x.bits==a.bits;}))out.push_back(a);
        };
        if(game->screenState==ScreenState::REWARDS) {
            for(int i=0;i<game->info.rewardsContainer.cardRewardCount;++i)
                add(search::GameAction(search::GameAction::RewardsActionType::CARD,i,5));
            for(int i=0;i<game->info.rewardsContainer.goldRewardCount;++i)
                add(search::GameAction(search::GameAction::RewardsActionType::GOLD,i));
        }
        for(int i=0;i<game->potionCapacity;++i) {
            add(search::GameAction(0x80000000U|i));add(search::GameAction(0xC0000000U|i));
        }
        return out;
    }
    bool valid(std::uint32_t bits) const {
        if (!game || game->outcome!=GameOutcome::UNDECIDED) return false;
        // Restrict to the safely enumerated action domain before invoking upstream validators.
        if (battle) {
            for (const auto &a:battleActions()) if (a.bits==bits) return true;
        } else for (const auto &a:gameActions())
            if (a.bits==bits && a.isValidAction(*game)) return true;
        return false;
    }
public:
    J inspect() const {
        if (!game) throw std::runtime_error("Reference not started");
        J actions=J::array();
        if (game->outcome==GameOutcome::UNDECIDED) {
            if (battle) for (const auto &a:battleActions()) {
                std::ostringstream description; a.printDesc(description,*battle);
                actions.push_back({{"bits",a.bits},{"description",description.str()},{"type",static_cast<int>(a.getActionType())},
                    {"source",a.getSourceIdx()},{"target",a.getTargetIdx()}});
            } else for (const auto &a:gameActions()) if (a.isValidAction(*game)) {
                std::ostringstream description; a.printDesc(description,*game);
                actions.push_back({{"bits",a.bits},{"description",description.str()},{"type",static_cast<int>(a.getRewardsActionType())},
                    {"index",a.getIdx1()},{"index2",a.getIdx2()},{"potion",a.isPotionAction()}});
            }
        }
        return {{"game",gameState(*game)},{"battle",battle?battleState(*battle):J(nullptr)},
            {"actions",actions},{"heartDefeated",heart},{"decisions",history.size()}};
    }
    J call(const J &q) {
        const auto op=q.at("op").get<std::string>();
        if (op=="start") {
            const auto seed=q.at("seed").get<std::string>(); std::size_t end=0;
            if (seed.empty() || seed.find_first_not_of("0123456789")!=std::string::npos) throw std::runtime_error("Invalid unsigned seed");
            const auto n=std::stoull(seed,&end); if (end!=seed.size()) throw std::runtime_error("Invalid seed");
            battle.reset(); game=std::make_unique<GameContext>(CharacterClass::IRONCLAD,n,20); heart=false; history=J::array();
            settle(); return inspect();
        }
        if(op=="adventureContentStart") {
            battle.reset();game=std::make_unique<GameContext>(CharacterClass::IRONCLAD,std::stoull(q.at("seed").get<std::string>()),20);heart=false;history=J::array();
            game->curHp=490;game->maxHp=500;game->gold=1000;game->deck.obtain(*game,Card(CardId::BARRICADE));game->deck.obtain(*game,Card(CardId::REGRET));
            game->screenState=ScreenState::MAP_SCREEN;game->regainControlAction=[](GameContext &g){g.screenState=ScreenState::MAP_SCREEN;};
            if(!q.at("relic").is_null())game->obtainRelic(static_cast<RelicId>(q.at("relic").get<int>()));
            if(!q.at("event").is_null()){game->obtainRelic(RelicId::GOLDEN_IDOL);game->obtainRelic(RelicId::CIRCLET);game->curRoom=Room::EVENT;game->curEvent=static_cast<Event>(q.at("event").get<int>());game->setupEvent();}
            settle();return inspect();
        }
        if(op=="combatPhaseStart") {
            J setup=q;setup["op"]="combatContentStart";setup["relics"]=J::array();setup["potion"]=nullptr;setup["durable"]=true;setup["elite"]=false;call(setup);
            const int slot=q.at("slot");if(!battle||slot<0||slot>=battle->monsters.monsterCount||battle->monsters.arr[slot].idx<0)throw std::runtime_error("Invalid phase fixture slot");
            auto &enemy=battle->monsters.arr[slot];enemy.curHp=std::min(enemy.maxHp,q.at("hp").get<int>());return inspect();
        }
        if(op=="combatContentStart") {
            battle.reset();game=std::make_unique<GameContext>(CharacterClass::IRONCLAD,std::stoull(q.at("seed").get<std::string>()),20);heart=false;history=J::array();
            if(q.at("durable").get<bool>()){game->curHp=9990;game->maxHp=10000;}
            if((!q.at("potion").is_null()&&static_cast<Potion>(q.at("potion").get<int>())==Potion::FAIRY_POTION)||std::any_of(q.at("relics").begin(),q.at("relics").end(),[](const J &id){return static_cast<RelicId>(id.get<int>())==RelicId::LIZARD_TAIL;})){game->curHp=1;game->maxHp=80;}
            for(const auto &r:q.at("relics"))if(game->obtainRelic(static_cast<RelicId>(r.get<int>())))throw std::runtime_error("Acquisition screen requires its own directed case");
            if(!q.at("potion").is_null())game->obtainPotion(static_cast<Potion>(q.at("potion").get<int>()));
            game->curRoom=q.at("elite").get<bool>()?Room::ELITE:Room::MONSTER;game->regainControlAction=[](GameContext &g){g.screenState=ScreenState::MAP_SCREEN;};
            game->enterBattle(static_cast<MonsterEncounter>(q.at("encounter").get<int>()));settle();return inspect();
        }
        if (op=="contentStart") {
            battle.reset();game=std::make_unique<GameContext>(CharacterClass::IRONCLAD,std::stoull(q.at("seed").get<std::string>()),20);heart=false;history=J::array();
            const auto id=static_cast<CardId>(q.at("id").get<int>());const bool permanent=Card(id).getType()!=CardType::STATUS;
            if(permanent)game->deck.obtain(*game,Card(id,q.at("upgraded").get<bool>()));
            game->curRoom=Room::MONSTER;game->regainControlAction=[](GameContext &g){g.screenState=ScreenState::MAP_SCREEN;};game->enterBattle(MonsterEncounter::CULTIST);settle();
            for(int i=0;i<battle->cards.cardsInHand;){const auto c=battle->cards.hand[i];if(permanent&&c.uniqueId==11){++i;continue;}Actions::ExhaustSpecificCardInHand(i,c.uniqueId).actFunc(*battle);}
            if(permanent){
                bool inHand=false;for(int i=0;i<battle->cards.cardsInHand;++i)inHand|=battle->cards.hand[i].uniqueId==11;
                if(!inHand){bool found=false;for(int i=0;i<battle->cards.drawPile.size();++i)if(battle->cards.drawPile[i].uniqueId==11){const auto c=battle->cards.drawPile[i];battle->cards.removeFromDrawPileAtIdx(i);battle->moveToHandHelper(c);found=true;break;}if(!found)throw std::runtime_error("Missing content subject");}
            }else Actions::MakeTempCardInHand(id,q.at("upgraded").get<bool>(),1).actFunc(*battle);
            for(const auto &support:q.at("support"))Actions::MakeTempCardInHand(static_cast<CardId>(support.get<int>()),false,1).actFunc(*battle);
            battle->cards.createTempCardInDrawPile(battle->cards.drawPile.size(),CardInstance(CardId::DAZED));
            battle->monsters.arr[0].curHp=q.at("enemyHp");battle->monsters.arr[0].maxHp=q.at("enemyHp");battle->player.gainBlock(*battle,10);battle->player.energy=20;battle->player.loseHp(*battle,3,true);
            if(q.value("strength",0)!=0)battle->player.buff<PS::STRENGTH>(q.at("strength").get<int>());
            if(q.value("vulnerable",0)!=0)Actions::DebuffEnemy<MS::VULNERABLE>(0,q.at("vulnerable").get<int>(),false).actFunc(*battle);
            if(q.value("attackIntent",false))battle->monsters.arr[0].moveHistory[0]=MonsterMoveId::CULTIST_DARK_STRIKE;
            return inspect();
        }
        if (op=="close") { battle.reset();game.reset();history=J::array();return nullptr; }
        if (op=="inspect") return inspect();
        if (op=="history") return history;
        if(op=="map") {
            const auto seed=std::stoull(q.at("seed").get<std::string>());const int act=q.at("act").get<int>();
            return mapState(act==4?Map::act4Map():Map::fromSeed(seed,q.value("ascension",20),act,q.value("burning",true)));
        }
        if(op=="encounters") {
            GameContext g;
            g.monsterRng=Random(std::stoull(q.at("seed").get<std::string>()));
            g.act=q.at("act").get<int>();g.ascension=q.value("ascension",20);
            if(g.act<1 || g.act>3)throw std::runtime_error("Invalid encounter act");
            g.generateMonsters();
            return {{"monsterList",enums(g.monsterList)},{"eliteList",enums(g.eliteMonsterList)},
                {"boss",static_cast<int>(g.boss)},{"secondBoss",static_cast<int>(g.secondBoss)},{"rng",rng(g.monsterRng)}};
        }
        if(op=="random") {
            Random r(std::stoull(q.at("seed").get<std::string>()));J values=J::array();
            for(const auto &step:q.at("steps")) {
                const auto kind=step.at("kind").get<std::string>();
                if(kind=="int")values.push_back(r.random(step.at("start").get<std::int32_t>(),step.at("end").get<std::int32_t>()));
                else if(kind=="float")values.push_back(r.random());
                else if(kind=="float-range")values.push_back(r.random(step.at("start").get<float>(),step.at("end").get<float>()));
                else if(kind=="long")values.push_back(std::to_string(r.randomLong()));
                else if(kind=="long-range")values.push_back(std::to_string(r.random(std::stoll(step.at("start").get<std::string>()),std::stoll(step.at("end").get<std::string>()))));
                else if(kind=="bool")values.push_back(step.contains("chance")?r.randomBoolean(step.at("chance").get<float>()):r.randomBoolean());
                else if(kind=="shuffle") {
                    std::vector<int> xs(step.at("size").get<int>());std::iota(xs.begin(),xs.end(),0);
                    java::Collections::shuffle(xs.begin(),xs.end(),java::Random(r.randomLong()));values.push_back(xs);
                } else throw std::runtime_error("Unknown random operation");
            }
            return {{"values",values},{"state",rng(r)}};
        }
        if(op=="event-sampling") {
            GameContext g(CharacterClass::IRONCLAD,std::stoull(q.at("seed").get<std::string>()),20);
            for(const auto &r:q.value("relics",J::array()))g.obtainRelic(static_cast<RelicId>(r.get<int>()));
            J out=J::array();
            for(const auto &lastShop:q.at("lastShops")) {
                g.curRoom=g.getEventRoomOutcomeHelper(lastShop.get<bool>());g.curEvent=Event::INVALID;
                if(g.curRoom==Room::EVENT)g.curEvent=g.generateEvent(g.eventRng);
                out.push_back({{"room",roomStrings[static_cast<int>(g.curRoom)]},{"event",static_cast<int>(g.curEvent)}});
            }
            return {{"outcomes",out},{"state",gameState(g)}};
        }
        if(op=="damage-case") {
            BattleContext b{};b.potions.fill(Potion::EMPTY_POTION_SLOT);b.monsters.monsterCount=1;b.monsters.monstersAlive=1;
            auto &p=b.player;auto &m=b.monsters.arr[0];m.id=MonsterId::CULTIST;m.idx=0;m.curHp=m.maxHp=q.value("enemyHp",100);m.block=q.value("enemyBlock",0);p.block=q.value("playerBlock",0);
            for(const auto &value:q.value("relics",J::array())){const int id=value;if(id<0||id>=128)throw std::runtime_error("Invalid player relic bit");if(id<64)p.relicBits0|=1ULL<<id;else p.relicBits1|=1ULL<<(id-64);}
            if(q.value("buffer",0))p.buff<PS::BUFFER>(q.at("buffer"));if(q.value("playerIntangible",0))p.buff<PS::INTANGIBLE>(q.at("playerIntangible"));if(q.value("enemyIntangible",0))m.buff<MS::INTANGIBLE>(q.at("enemyIntangible"));
            const auto view=[&](){J statuses=J::array();for(const auto &entry:p.statusMap)statuses.push_back({static_cast<int>(entry.first),entry.second});
                return J{{"player",{{"hp",p.curHp},{"block",p.block},{"timesDamaged",p.timesDamagedThisCombat},{"lastAttack",p.lastAttackUnblockedDamage},{"statuses",statuses},{"bits",std::to_string(p.statusBits0)},{"justApplied",p.justAppliedBits}}},
                    {"enemy",{{"hp",m.curHp},{"block",m.block},{"intangible",m.getStatus<MS::INTANGIBLE>()},{"bits",std::to_string(m.statusBits)}}}};
            };
            J out=J::array();out.push_back(view());
            for(const auto &step:q.at("steps")){
                const int target=step.at("target"),amount=step.at("amount");const bool attack=step.value("attack",false),selfDamage=step.value("selfDamage",false);
                if(step.value("direct",false))p.loseHp(b,amount,selfDamage);
                else if(target==0){if(attack)p.attacked(b,0,step.value("calculate",false)?m.calculateDamageToPlayer(b,amount):amount);else p.damage(b,amount,selfDamage);}
                else {const int value=step.value("calculate",false)?b.calculateCardDamage(CardInstance(CardId::STRIKE_RED),0,amount):amount;if(attack)m.attacked(b,value);else m.damage(b,value);}
                out.push_back(view());
            }
            return out;
        }
        if(op=="power-case") {
            BattleContext b{};b.potions.fill(Potion::EMPTY_POTION_SLOT);b.monsters.monsterCount=1;b.monsters.monstersAlive=1;
            auto &p=b.player;auto &m=b.monsters.arr[0];m.id=MonsterId::CULTIST;m.idx=0;m.curHp=m.maxHp=100;
            const auto view=[&](){
                J statuses=J::array();for(const auto &entry:p.statusMap)statuses.push_back({static_cast<int>(entry.first),entry.second});
                J math=J::array();for(const auto &value:q.at("bases")){const int base=value;math.push_back({base,b.calculateCardDamage(CardInstance(CardId::STRIKE_RED),0,base),m.calculateDamageToPlayer(b,base),b.calculateCardBlock(base)});}
                return J{{"player",{{"strength",p.strength},{"dexterity",p.dexterity},{"focus",p.focus},{"artifact",p.artifact},{"statusBits0",std::to_string(p.statusBits0)},{"statusBits1",p.statusBits1},{"justApplied",p.justAppliedBits},{"statuses",statuses}}},
                    {"enemy",{{"strength",m.strength},{"weak",m.weak},{"vulnerable",m.vulnerable},{"artifact",m.artifact},{"statusBits",std::to_string(m.statusBits)}}},{"math",math}};
            };
            J out=J::array();out.push_back(view());
            for(const auto &step:q.at("steps")) {
                const int status=step.at("status");
                if(step.at("target").get<int>()==0)switch(static_cast<PS>(status)){
                    case PS::STRENGTH:playerPowerStep<PS::STRENGTH>(p,step);break;
                    case PS::DEXTERITY:playerPowerStep<PS::DEXTERITY>(p,step);break;
                    case PS::FOCUS:playerPowerStep<PS::FOCUS>(p,step);break;
                    case PS::ARTIFACT:playerPowerStep<PS::ARTIFACT>(p,step);break;
                    case PS::WEAK:playerPowerStep<PS::WEAK>(p,step);break;
                    case PS::VULNERABLE:playerPowerStep<PS::VULNERABLE>(p,step);break;
                    case PS::FRAIL:playerPowerStep<PS::FRAIL>(p,step);break;
                    case PS::NO_BLOCK:playerPowerStep<PS::NO_BLOCK>(p,step);break;
                    default:throw std::runtime_error("Unsupported player fixture power");
                }else switch(static_cast<MS>(status)){
                    case MS::STRENGTH:enemyPowerStep<MS::STRENGTH>(b,step);break;
                    case MS::WEAK:enemyPowerStep<MS::WEAK>(b,step);break;
                    case MS::VULNERABLE:enemyPowerStep<MS::VULNERABLE>(b,step);break;
                    case MS::ARTIFACT:enemyPowerStep<MS::ARTIFACT>(b,step);break;
                    default:throw std::runtime_error("Unsupported enemy fixture power");
                }
                out.push_back(view());
            }
            return out;
        }
        if(op=="card-instance-case") {
            CardInstance c(static_cast<CardId>(q.at("id").get<int>()),q.value("upgraded",false));
            c.specialData=q.value("specialData",0);c.setUniqueId(q.value("uniqueId",-1));
            const auto view=[&](){return J{{"card",card(c)},{"canUpgrade",c.canUpgrade()},{"upgradeCount",c.getUpgradeCount()}};};
            J out=J::array();out.push_back(view());
            for(const auto &step:q.at("steps")) {
                const auto kind=step.at("kind").get<std::string>();const int amount=step.value("amount",0);
                if(kind=="setCostForCombat")c.setCostForCombat(amount);
                else if(kind=="setCostForTurn")c.setCostForTurn(amount);
                else if(kind=="overrideTurnCost")c.costForTurn=static_cast<std::int8_t>(amount);
                else if(kind=="upgradeBaseCost")c.upgradeBaseCost(amount);
                else if(kind=="updateCost")c.updateCost(amount);
                else if(kind=="upgrade"){if(c.canUpgrade())c.upgrade();}
                else if(kind=="resetTurn")c.setCostForTurn(c.cost);
                else if(kind=="setSpecialData")c.specialData=static_cast<std::int16_t>(amount);
                else if(kind=="setFlags"){c.freeToPlayOnce=step.at("freeToPlayOnce");c.retain=step.at("retain");}
                else throw std::runtime_error("Unknown card instance operation");
                out.push_back(view());
            }
            return out;
        }
        if(op=="play-case"||op=="turn-case") {
            const bool turns=op=="turn-case";
            // Directed production useCard/onAfterUseCard flow; the active normal run remains untouched.
            BattleContext b{};b.potions.fill(Potion::EMPTY_POTION_SLOT);auto &p=b.player;auto &m=b.monsters.arr[0];
            b.monsters.monsterCount=1;b.monsters.monstersAlive=1;b.monsterTurnIdx=1;m.id=MonsterId::CULTIST;m.idx=0;m.curHp=m.maxHp=q.value("enemyHp",100);
            p.energy=q.value("energy",10);if(q.value("dexterity",0))p.buff<PS::DEXTERITY>(q.at("dexterity"));if(q.value("frail",0))p.buff<PS::FRAIL>(q.at("frail"));b.turn=1;b.shuffleRng=Random(std::stoull(q.at("seed").get<std::string>()));b.cardRandomRng=Random(std::stoull(q.at("seed").get<std::string>()));
            if(turns){b.ascension=20;b.aiRng=Random(std::stoull(q.at("seed").get<std::string>()));m.rollMove(b);p.cardDrawPerTurn=5;p.energyPerTurn=3;}
            GameContext g{};for(const auto &value:q.at("deck")){Card c(static_cast<CardId>(value.at("id").get<int>()),value.value("upgraded",false));c.misc=value.value("misc",0);g.deck.obtainRaw(c);}b.cards.init(g,b);b.drawCards(q.at("draw"));
            const auto view=[&](){J hand=J::array(),queue=J::array(),statuses=J::array();for(int i=0;i<b.cards.cardsInHand;++i)hand.push_back(card(b.cards.hand[i]));for(int i=0;i<b.cardQueue.size;++i)queue.push_back(cardPlay(b.cardQueue.arr[(b.cardQueue.frontIdx+i)%CardQueue::capacity]));for(const auto &entry:p.statusMap)statuses.push_back({static_cast<int>(entry.first),entry.second});
                J result{{"cards",{{"draw",cardList(b.cards.drawPile)},{"hand",hand},{"discard",cardList(b.cards.discardPile)},{"exhaust",cardList(b.cards.exhaustPile)}}},{"current",cardPlay(b.curCardQueueItem)},{"queue",queue},{"actions",b.actionQueue.size},{"outcome",static_cast<int>(b.outcome)},{"drawn",b.cardsDrawn},
                    {"player",{{"hp",p.curHp},{"block",p.block},{"energy",p.energy},{"cardsPlayed",p.cardsPlayedThisTurn},{"attacksPlayed",p.attacksPlayedThisTurn},{"skillsPlayed",p.skillsPlayedThisTurn},{"lastTarget",p.lastTargetedMonster},{"strength",p.strength},{"dexterity",p.dexterity},{"bits",std::to_string(p.statusBits0)},{"statuses",statuses}}},
                    {"enemy",{{"hp",m.curHp},{"block",m.block},{"vulnerable",m.vulnerable},{"bits",std::to_string(m.statusBits)}}},{"shuffleRng",rng(b.shuffleRng)},{"cardRng",rng(b.cardRandomRng)}};
                if(turns){result["turn"]=b.turn;result["energyWasted"]=b.energyWasted;result["endTurnQueued"]=b.endTurnQueued;result["discarded"]=p.cardsDiscardedThisTurn;result["aiRng"]=rng(b.aiRng);result["enemy"]["strength"]=m.strength;result["enemy"]["ritual"]=m.getStatus<MS::RITUAL>();result["enemy"]["history"]=J::array({static_cast<int>(m.moveHistory[0]),static_cast<int>(m.moveHistory[1])});const auto intent=m.getMoveBaseDamage(b);result["enemy"]["intent"]={{"attack",intent.attackCount>0},{"damage",intent.damage},{"hits",intent.attackCount}};}return result;
            };
            J out=J::array(),interactions=J::array();out.push_back(view());std::size_t replyIndex=0;const auto replies=q.value("replies",J::array());
            const auto settleFixture=[&](){
                    b.setState(InputState::EXECUTING_ACTIONS);b.executeActions();
                    while(b.inputState==InputState::CARD_SELECT){
                        const auto task=b.cardSelectInfo.cardSelectTask;const bool headbutt=task==CardSelectTask::HEADBUTT;
                        if(!headbutt&&task!=CardSelectTask::WARCRY)throw std::runtime_error("Unexpected fixture selection");
                        J selected=J::array(),bits=J::array();if(headbutt)selected=cardList(b.cards.discardPile);else for(int i=0;i<b.cards.cardsInHand;++i)selected.push_back(card(b.cards.hand[i]));
                        for(int i=0;i<selected.size();++i)bits.push_back((2U<<29)|static_cast<unsigned>(i));interactions.push_back({{"screen",static_cast<int>(task)},{"cards",selected},{"bits",bits}});
                        if(replyIndex>=replies.size())throw std::runtime_error("Missing fixture choice reply");const unsigned index=replies.at(replyIndex++);search::Action a((2U<<29)|index);if(!a.isValidAction(b))throw std::runtime_error("Invalid fixture choice reply");a.execute(b);
                    }

            };
            for(const auto &step:q.at("steps")){
                const auto kind=step.at("kind").get<std::string>();
                if(kind=="fight"){
                    int decisions=0;while(b.outcome==Outcome::UNDECIDED){if(++decisions>200)throw std::runtime_error("Battle policy exceeded its test horizon");int index=-1;for(int i=0;i<b.cards.cardsInHand;++i)if(b.cards.hand[i].canUse(b,0,false)){index=i;break;}if(index<0)b.endTurn();else b.cardQueue.pushBack(CardQueueItem(b.cards.hand[index],0,p.energy));settleFixture();out.push_back(view());}continue;
                }
                else if(kind=="endTurn"){b.endTurn();}
                else if(kind=="retain"){int index=-1;for(int i=0;i<b.cards.cardsInHand;++i)if(static_cast<int>(b.cards.hand[i].id)==step.at("id").get<int>()){index=i;break;}if(index<0)throw std::runtime_error("Retain card missing");b.cards.hand[index].retain=true;}
                else if(kind=="queue"||kind=="cost"){
                    int index=-1;for(int i=0;i<b.cards.cardsInHand;++i)if(static_cast<int>(b.cards.hand[i].id)==step.at("id").get<int>()){index=i;break;}if(index<0)throw std::runtime_error("Card is not in fixture hand");
                    if(kind=="cost")b.cards.hand[index].costForTurn=step.at("amount").get<std::int8_t>();
                    else{CardQueueItem item(b.cards.hand[index],0,p.energy);const auto o=step.value("options",J::object());item.autoplay=o.value("autoplay",false);item.triggerOnUse=o.value("triggerOnUse",true);item.purgeOnUse=o.value("purgeOnUse",false);item.freeToPlay=o.value("freeToPlay",false);item.ignoreEnergyTotal=o.value("ignoreEnergyTotal",false);item.randomTarget=o.value("randomTarget",false);item.exhaustOnUse=o.value("exhaustOnUse",false);item.regretCardCount=o.value("regretCardCount",0);b.cardQueue.pushBack(item);}
                }else if(kind=="play"){if(!b.actionQueue.isEmpty()||b.cardQueue.isEmpty())throw std::runtime_error("Not a card execution boundary");b.playCardQueueItem(b.cardQueue.popFront());}
                else if(kind=="oneAction"){if(b.actionQueue.isEmpty())throw std::runtime_error("No queued action");b.actionQueue.popFront()(b);}
                else if(kind=="settle")settleFixture();
                else throw std::runtime_error("Unknown card-play operation");
                out.push_back(view());
            }
            if(q.value("captureChoices",false))return J{{"states",out},{"interactions",interactions}};return out;
        }
        if(op=="pile-case") {
            // Isolated real CardManager/BattleContext operations. No active-run state is injected.
            BattleContext b{};b.potions.fill(Potion::EMPTY_POTION_SLOT);auto &p=b.player;
            b.shuffleRng=Random(std::stoull(q.at("seed").get<std::string>()));b.cardRandomRng=Random(std::stoull(q.at("cardSeed").get<std::string>()));p.energy=q.value("energy",3);
            if(q.value("confused",false))p.buff<PS::CONFUSED>(1);
            if(q.value("noDraw",false))p.buff<PS::NO_DRAW>(1);
            if(q.value("evolve",0))p.buff<PS::EVOLVE>(q.at("evolve"));
            if(q.value("darkEmbrace",0))p.buff<PS::DARK_EMBRACE>(q.at("darkEmbrace"));
            if(q.value("feelNoPain",0))p.buff<PS::FEEL_NO_PAIN>(q.at("feelNoPain"));
            for(const auto &value:q.value("relics",J::array())){const int id=value;if(id<0||id>=128)throw std::runtime_error("Invalid relic bit");if(id<64)p.relicBits0|=1ULL<<id;else p.relicBits1|=1ULL<<(id-64);}
            if(q.contains("deck")){
                GameContext g{};
                for(const auto &value:q.at("deck")){Card c(static_cast<CardId>(value.at("id").get<int>()),value.value("upgraded",false));c.misc=value.value("misc",0);g.deck.obtainRaw(c);}
                int bottle=0;for(const auto &index:q.value("bottles",J::array()))g.deck.bottleIdxs.at(bottle++)=index.get<int>();
                p.cardDrawPerTurn=q.value("drawPerTurn",5);b.cards.init(g,b);
            }
            for(const auto &name:{"draw","hand","discard","exhaust"})for(const auto &value:q.at(name)){
                CardInstance c(static_cast<CardId>(value.at("id").get<int>()),value.value("upgraded",false));c.uniqueId=value.at("uniqueId").get<std::int16_t>();
                if(value.contains("cost"))c.cost=value.at("cost");if(value.contains("costForTurn"))c.costForTurn=value.at("costForTurn");c.retain=value.value("retain",false);c.freeToPlayOnce=value.value("freeToPlayOnce",false);
                if(std::string(name)=="exhaust")b.cards.exhaustPile.push_back(c);
                else {b.cards.notifyAddCardToCombat(c);if(std::string(name)=="draw")b.cards.moveToDrawPileTop(c);else if(std::string(name)=="hand")b.cards.moveToHand(c);else b.cards.moveToDiscardPile(c);}
            }
            const auto view=[&](){J hand=J::array(),statuses=J::array();for(int i=0;i<b.cards.cardsInHand;++i)hand.push_back(card(b.cards.hand[i]));for(const auto &entry:p.statusMap)statuses.push_back({static_cast<int>(entry.first),entry.second});
                return J{{"cards",{{"draw",cardList(b.cards.drawPile)},{"hand",hand},{"discard",cardList(b.cards.discardPile)},{"exhaust",cardList(b.cards.exhaustPile)}}},
                    {"drawn",b.cardsDrawn},{"discarded",p.cardsDiscardedThisTurn},{"nextUniqueId",b.cards.nextUniqueCardId},{"queueSize",b.actionQueue.size},
                    {"player",{{"energy",p.energy},{"block",p.block},{"sundial",p.sundialCounter},{"statuses",statuses},{"bits",std::to_string(p.statusBits0)}}},
                    {"counts",{b.cards.strikeCount,b.cards.handPainCount,b.cards.handNormalityCount,b.cards.handBloodCardCount,b.cards.drawPileBloodCardCount,b.cards.discardPileBloodCardCount}},
                    {"shuffleRng",rng(b.shuffleRng)},{"cardRng",rng(b.cardRandomRng)}};
            };
            J out=J::array();out.push_back(view());
            for(const auto &step:q.at("steps")){
                const auto kind=step.at("kind").get<std::string>();
                if(kind=="draw")b.drawCards(step.at("count"));
                else if(kind=="settle"){int guard=0;while(!b.actionQueue.isEmpty()){if(++guard>1000)throw std::runtime_error("Unbounded pile fixture");b.actionQueue.popFront()(b);}}
                else if(kind=="discardHand")b.discardAtEndOfTurnHelper();
                else if(kind=="exhaust")b.exhaustSpecificCardInHand(step.at("index"),b.cards.hand[step.at("index").get<int>()].uniqueId);
                else if(kind=="resetCosts")b.cards.resetAttributesAtEndOfTurn();
                else if(kind=="shuffleDraw")Actions::ShuffleDrawPile().actFunc(b);
                else if(kind=="shuffleDiscard")Actions::EmptyDeckShuffle().actFunc(b);
                else if(kind=="removeNoDraw")p.removeStatus<PS::NO_DRAW>();
                else throw std::runtime_error("Unknown pile operation");
                out.push_back(view());
            }
            return out;
        }
        if(op=="zone-case") {
            // Directed CardManager moves, independent of the active run and its hidden state.
            CardManager cards;cards.nextUniqueCardId=1;
            for(int i=0;i<q.at("count").get<int>();++i)cards.createTempCardInDrawPile(i,CardInstance(CardId::STRIKE_RED));
            const auto view=[&](){
                const auto ids=[](const auto &list){J result=J::array();for(const auto &c:list)result.push_back(c.uniqueId);return result;};
                J hand=J::array();for(int i=0;i<cards.cardsInHand;++i)hand.push_back(cards.hand[i].uniqueId);
                return J{{"draw",ids(cards.drawPile)},{"hand",hand},{"discard",ids(cards.discardPile)},{"exhaust",ids(cards.exhaustPile)}};
            };
            J out=J::array();out.push_back(view());
            for(const auto &step:q.at("steps")) {
                const auto from=step.at("from").get<std::string>(),to=step.at("to").get<std::string>();const int index=step.at("index");
                CardInstance c;
                if(from=="draw"){c=cards.drawPile.at(index);cards.removeFromDrawPileAtIdx(index);}
                else if(from=="hand"){if(index<0||index>=cards.cardsInHand)throw std::runtime_error("Invalid hand index");c=cards.hand[index];cards.removeFromHandAtIdx(index);}
                else if(from=="discard"){c=cards.discardPile.at(index);cards.removeFromDiscard(index);}
                else if(from=="exhaust"){c=cards.exhaustPile.at(index);cards.removeFromExhaustPile(index);}
                else throw std::runtime_error("Unknown source pile");
                if(to=="draw")cards.insertToDrawPile(step.value("position",static_cast<int>(cards.drawPile.size())),c);
                else if(to=="hand")cards.moveToHand(c);
                else if(to=="discard")cards.moveToDiscardPile(c);
                else if(to=="exhaust")cards.moveToExhaustPile(c);
                else throw std::runtime_error("Unknown destination pile");
                out.push_back(view());
            }
            return out;
        }
        if(op=="resource-case") {
            // Isolated primitive oracle. No relics/powers or actions are installed; active run is untouched.
            BattleContext b{}; b.potions.fill(Potion::EMPTY_POTION_SLOT);
            auto &p=b.player;const auto &s=q.at("setup");
            p.curHp=s.at("hp");p.maxHp=s.at("maxHp");p.block=s.at("block");p.energy=s.at("energy");p.gold=s.at("gold");
            for(const auto &relic:q.value("relics",J::array())) {
                const int id=relic.get<int>();if(id<0||id>=128)throw std::runtime_error("Unsupported player relic bit index");
                if(id<64)p.relicBits0|=1ULL<<id;else p.relicBits1|=1ULL<<(id-64);
            }
            const auto view=[&](){return J{{"hp",p.curHp},{"maxHp",p.maxHp},{"block",p.block},{"energy",p.energy},{"gold",p.gold}};};
            J out=J::array();out.push_back(view());
            for(const auto &step:q.at("steps")) {
                const auto kind=step.at("kind").get<std::string>();const int amount=step.at("amount");
                if(kind=="heal")p.heal(amount);
                else if(kind=="loseHp")p.loseHp(b,amount,step.value("selfDamage",false));
                else if(kind=="gainBlock")p.gainBlock(b,amount);
                else if(kind=="consumeBlock") {
                    if(amount>p.block)throw std::runtime_error("Primitive block oracle requires a fully blocked hit");
                    p.damage(b,amount,false);
                }
                else if(kind=="gainEnergy")p.gainEnergy(amount);
                else if(kind=="useEnergy")p.useEnergy(amount);
                else if(kind=="gainGold")p.gainGold(b,amount);
                else if(kind=="raiseMaxHp")p.increaseMaxHp(amount);
                else throw std::runtime_error("Unknown resource case operation");
                out.push_back(view());
            }
            return out;
        }
        if(op=="shop-case") {
            // Isolated shop semantics; never edits the active normal run.
            GameContext g(CharacterClass::IRONCLAD,std::stoull(q.at("seed").get<std::string>()),20);
            for(const auto &r:q.value("relics",J::array()))g.obtainRelic(static_cast<RelicId>(r.get<int>()));
            g.gold=10000;g.curEvent=Event::INVALID;g.curRoom=Room::SHOP;g.screenState=ScreenState::SHOP_ROOM;
            g.regainControlAction=[](auto &x){x.screenState=ScreenState::MAP_SCREEN;};g.info.shop.setup(g);
            J out=J::array();out.push_back(gameState(g));
            for(const auto &step:q.at("steps")) {
                const auto kind=step.at("kind").get<std::string>();const int i=step.value("index",0);
                if(kind=="action")search::GameAction(step.at("bits").get<std::uint32_t>()).execute(g);
                else if(kind=="card")g.info.shop.buyCard(g,i);
                else if(kind=="relic")g.info.shop.buyRelic(g,i);
                else if(kind=="potion")g.info.shop.buyPotion(g,i);
                else if(kind=="remove")g.info.shop.buyCardRemove(g);
                else if(kind=="select")g.chooseSelectCardScreenOption(i);
                else throw std::runtime_error("Unknown shop case operation");
                out.push_back(gameState(g));
            }
            return out;
        }
        if(op=="definitions") {
            J cards=J::object();
            for(int i=1;i<=static_cast<int>(CardId::ZAP);++i) {
                const auto id=static_cast<CardId>(i);const auto color=getCardColor(id);
                const auto *pool=TrulyRandomCardPool::getPoolForClass(CharacterClass::IRONCLAD);
                const bool ironclad=std::find(pool,pool+TrulyRandomCardPool::getPoolSizeForClass(CharacterClass::IRONCLAD),id)
                    !=pool+TrulyRandomCardPool::getPoolSizeForClass(CharacterClass::IRONCLAD);
                if(!ironclad && color!=CardColor::RED && color!=CardColor::COLORLESS && color!=CardColor::CURSE)continue;
                J variants=J::array();
                for(bool u:{false,true})variants.push_back({{"cost",getEnergyCost(id,u)},{"damage",getBaseDamage(id,u)},
                    {"innate",isCardInnate(id,u)},{"ethereal",isCardEthereal(id,u)},{"exhaust",doesCardExhaust(id,u)},
                    {"retain",doesCardSelfRetain(id,u)},{"target",cardTargetsEnemy(id,u)}});
                cards[getCardEnumName(id)]={{"name",getCardName(id)},{"type",static_cast<int>(getCardType(id))},
                    {"color",static_cast<int>(color)},{"rarity",static_cast<int>(getCardRarity(id))},
                    {"strike",isCardStrikeCard(id)},{"variants",variants}};
            }
            return cards;
        }
        if(op=="battle-exit-case") {
            GameContext g(CharacterClass::IRONCLAD,std::stoull(q.at("seed").get<std::string>()),20);g.regainControlAction=[](GameContext &){};
            BattleContext b{};b.player.curHp=g.curHp;b.player.maxHp=g.maxHp;b.player.gold=g.gold;b.outcome=Outcome::PLAYER_VICTORY;b.monsters.arr[0].id=MonsterId::CULTIST;b.exitBattle(g);g.deck.remove(g,1);const auto state=gameState(g);
            return J{{"hp",g.curHp},{"maxHp",g.maxHp},{"gold",g.gold},{"deck",state.at("deck")},{"bottles",state.at("bottles")},{"deckCounts",state.at("deckCounts")},{"upgradeableCount",state.at("upgradeableCount")},{"transformableCount",state.at("transformableCount")}};
        }
        if(op=="deck-case") {
            // Isolated semantic example; never modifies the active run or produces a run trace.
            GameContext g(CharacterClass::IRONCLAD,std::stoull(q.at("seed").get<std::string>()),20);
            for(const auto &r:q.value("relics",J::array()))
                g.relics.add({static_cast<RelicId>(r.at("id").get<int>()),r.value("data",0)});
            const auto view=[&](){const auto state=gameState(g);J owned=J::array();for(const auto &relic:state.at("relics"))if(relic.at("id")!="BURNING_BLOOD")owned.push_back(relic);return J{{"deck",state.at("deck")},{"bottles",state.at("bottles")},{"deckCounts",state.at("deckCounts")},{"upgradeableCount",state.at("upgradeableCount")},{"transformableCount",state.at("transformableCount")},{"hp",g.curHp},{"maxHp",g.maxHp},{"gold",g.gold},{"relics",owned},{"miscRng",rng(g.miscRng)}};};
            J states=J::array({view()});
            for(const auto &s:q.at("steps")) {
                const auto kind=s.at("kind").get<std::string>();
                if(kind=="obtain") {
                    const auto name=s.at("id").get<std::string>();CardId id=CardId::INVALID;
                    for(int i=1;i<=static_cast<int>(CardId::ZAP);++i)
                        if(name==getCardEnumName(static_cast<CardId>(i))){id=static_cast<CardId>(i);break;}
                    if(id==CardId::INVALID)throw std::runtime_error("Unknown test card");
                    Card c(id,s.value("upgraded",false));c.misc=s.value("misc",0);
                    g.deck.obtain(g,c,s.value("count",1));
                } else if(kind=="remove")g.deck.remove(g,s.at("index").get<int>());
                else if(kind=="upgrade")g.deck.upgrade(s.at("index").get<int>());
                else if(kind=="upgrade-random")g.deck.upgradeRandomCards(g.miscRng,s.at("count").get<int>());
                else if(kind=="bottle")g.deck.bottleCard(s.at("index").get<int>(),static_cast<CardType>(s.at("type").get<int>()));
                else throw std::runtime_error("Unknown deck test operation");
                states.push_back(view());
            }
            if(q.value("captureSteps",false))return states;return gameState(g);
        }
        if (op=="catalog") {
            J cards=J::object(),relics=J::object();
            for(int i=1;i<=static_cast<int>(CardId::ZAP);++i) {
                const auto id=static_cast<CardId>(i);
                cards[getCardEnumName(id)]={{"name",getCardName(id)},{"type",static_cast<int>(getCardType(id))},
                    {"weight",search::Expert::getObtainWeight(id)},{"playOrder",search::Expert::getPlayOrdering(id)}};
            }
            for(int i=0;i<static_cast<int>(RelicId::INVALID);++i) {
                const auto id=static_cast<RelicId>(i);
                relics[std::to_string(i)]={{"id",relicEnumNames[i]},{"bossOrder",search::Expert::getBossRelicOrdering(id)}};
            }
            return {{"cards",cards},{"relics",relics}};
        }
        if (!game) throw std::runtime_error("Reference not started");
        if (op=="debug") { std::ostringstream s; s<<*game; if(battle)s<<*battle; return s.str(); }
        if (op=="search") {
            if (!battle) throw std::runtime_error("Search requires battle");
            const int count=q.value("simulations",10000); if (count<1 || count>1000000) throw std::runtime_error("Invalid search budget");
            const auto before=inspect();
            search::BattleScumSearcher2 searcher(*battle); searcher.randGen.seed(q.value("seed",1));searcher.search(count);
            J candidates=J::array();
            for (const auto &e:searcher.root.edges) candidates.push_back({{"bits",e.action.bits},{"visits",e.node.simulationCount},{"value",e.node.evaluationSum}});
            J solution=J::array(); for (const auto &a:searcher.bestActionSequence) solution.push_back(a.bits);
            if (before!=inspect()) throw std::runtime_error("Search mutated active game");
            return {{"outcomeHp",searcher.outcomePlayerHp},{"solution",solution},{"candidates",candidates}};
        }
        if(op=="beam") {
            if(!battle)throw std::runtime_error("Search requires battle");
            const int width=q.value("width",128),depth=q.value("depth",160);
            if(width<1 || width>2048 || depth<1 || depth>500)throw std::runtime_error("Invalid beam budget");
            const auto before=inspect();const auto result=beamSearch(*battle,width,depth);
            if(before!=inspect())throw std::runtime_error("Search mutated active game");
            return result;
        }
        if (op=="validate" || op=="advance" || op=="upstreamAdvance") {
            const auto bits64=q.at("bits").get<std::uint64_t>();
            const bool ok=bits64<=UINT32_MAX && valid(static_cast<std::uint32_t>(bits64));
            if (op=="validate") return ok;
            if (!ok) throw std::runtime_error("Illegal action");
            const auto bits=static_cast<std::uint32_t>(bits64);
            history.push_back({{"kind",battle?"battle":"game"},{"screen",screenName(game->screenState)},{"bits",bits}});
            if (battle) search::Action(bits).execute(*battle);
            else {
                const search::GameAction action(bits);
                // The pinned GameAction helper falls through into the active screen after a potion.
                // Drive the actual player primitive exactly once; upstreamAdvance preserves the
                // broken helper for the dedicated normal-start regression.
                if (op=="advance" && action.isPotionAction()) {
                    if (action.isPotionDiscard()) game->discardPotionAtIdx(action.getIdx1());
                    else game->drinkPotionAtIdx(action.getIdx1());
                } else action.execute(*game);
            }
            settle(); return inspect();
        }
        throw std::runtime_error("Unknown operation");
    }
};

int main() {
    Reference ref;std::string line;
    while (std::getline(std::cin,line)) {
        std::ostringstream noise; auto original=std::cout.rdbuf(noise.rdbuf()); J reply;
        try { reply={{"ok",true},{"value",ref.call(J::parse(line))}}; }
        catch (const std::exception &e) { reply={{"ok",false},{"error",e.what()}}; }
        std::cout.rdbuf(original);if(!noise.str().empty())std::cerr<<noise.str();
        std::cout<<reply.dump()<<std::endl;
    }
}
